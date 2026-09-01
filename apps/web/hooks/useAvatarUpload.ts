'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarUploadState, ProfileImageUrls, UseAvatarUploadReturn } from '@/lib/types/api';
import {
  AVATAR_POLL_INTERVAL_MS,
  AVATAR_POLL_MAX_ATTEMPTS,
  AVATAR_POLL_MAX_FAILURES,
  AVATAR_POLL_BACKOFF_MAX_MS,
} from '@/lib/profile/settingsConstants';
import { profileImageFileSchema } from '@/lib/profile/settingsSchemas';
import { preflightImage } from '@/lib/profile/imageFile';
import { AVATAR_PIPELINE_MESSAGES } from '@/lib/profile/profileSettingsMessages';
import { mintIdempotencyKey } from '@/lib/idempotency';
import { uploadToStorage } from '@/lib/profile/uploadToStorage';
import {
  requestAvatarUploadAction,
  commitAvatarAction,
  getAvatarStatusAction,
  setAvatarAction,
} from '@/app/actions/profile';

// Orchestrates the avatar pipeline (TOV-35 / FR-01.09): pick → request signed target → direct Supabase PUT →
// commit → poll the webp derivation → activate. Mirrors the codebase's ref-guarded async pattern
// (useKycSubmission busyRef/cancelledRef; useWhitelistStatusPolling recursive-setTimeout + inFlightRef + pollRef
// indirection + backoff). Every attempt owns a monotonic GENERATION and a fresh idempotency key (bumped
// together by resetAttempt): an awaited continuation captures its generation at dispatch and no-ops if a newer
// attempt has since started, so a late `ready` for a superseded upload can never activate. The preview object
// URL is created + revoked in ONE effect keyed on the selected file (never a useMemo).

interface Options {
  onAvatarActivated: (img: ProfileImageUrls | null) => void;
  onSessionExpired: () => void;
}

// Exponential backoff between CONSECUTIVE transport failures (429/5xx/network) so a flapping backend isn't
// re-hit at the flat 1.5s cadence: 1.5s → 3s → 6s, capped. Distinct from the success cadence.
function pollBackoffMs(failures: number): number {
  return Math.min(AVATAR_POLL_INTERVAL_MS * 2 ** (failures - 1), AVATAR_POLL_BACKOFF_MAX_MS);
}

export function useAvatarUpload(
  initialImage: ProfileImageUrls | null,
  opts: Options,
): UseAvatarUploadReturn {
  const [state, setState] = useState<AvatarUploadState>({ status: 'idle' });
  const stateRef = useRef<AvatarUploadState>(state);
  // Mount-seeded from the SSR prop; thereafter owned here (updated on activate/remove). A later change to
  // the `initialImage` prop is NOT reconciled — intentional (no router.refresh() drives this surface).
  const [activeImage, setActiveImage] = useState<ProfileImageUrls | null>(initialImage);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Latest callbacks in refs so the async closures below never need them as deps (opts is a fresh object each
  // render; capturing it directly would churn every useCallback).
  const onActivatedRef = useRef(opts.onAvatarActivated);
  const onSessionExpiredRef = useRef(opts.onSessionExpired);
  useEffect(() => {
    onActivatedRef.current = opts.onAvatarActivated;
    onSessionExpiredRef.current = opts.onSessionExpired;
  });

  const generationRef = useRef(0);
  const keyRef = useRef<string>('');
  const profileImageIdRef = useRef<string | null>(null);
  const attemptsRef = useRef(0);
  const failuresRef = useRef(0);
  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<(gen: number) => void>(() => {});

  const setStateAndRef = useCallback((next: AvatarUploadState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Bump the generation AND mint a fresh idempotency key together — one atomic "start a new attempt" so a stale
  // continuation is invalidated and a byte-different upload never reuses a key. Returns the new generation.
  const resetAttempt = useCallback(() => {
    generationRef.current += 1;
    keyRef.current = mintIdempotencyKey();
    // Release the shared in-flight flag: a superseded generation's still-running (unabortable) status poll
    // has its result discarded by the generation check anyway, so its "busy" flag is meaningless to the new
    // attempt. Without this, re-picking a file while a status poll hangs leaves the new attempt's only poll
    // tick bailing on a stale inFlightRef and never re-arming — wedging forever on "Processing…" (TOV-35 #216).
    inFlightRef.current = false;
    return generationRef.current;
  }, []);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const schedulePoll = useCallback(
    (gen: number, delayMs: number) => {
      if (cancelledRef.current || generationRef.current !== gen) return;
      clearPollTimer();
      pollTimerRef.current = setTimeout(() => pollRef.current(gen), delayMs);
    },
    [clearPollTimer],
  );

  // Terminal activate step, shared by the commit-returns-ready fast path and the poll-sees-ready path.
  const activate = useCallback(
    async (profileImageId: string, gen: number) => {
      setStateAndRef({ status: 'activating' });
      const res = await setAvatarAction(profileImageId);
      if (cancelledRef.current || generationRef.current !== gen) return;
      if (res.status === 'error') {
        if (res.code === 'SESSION_EXPIRED') {
          onSessionExpiredRef.current();
          return;
        }
        setStateAndRef({
          status: 'error',
          phase: 'activate',
          code: res.code,
          message: res.message,
        });
        return;
      }
      const img = res.profile.profileImage;
      setActiveImage(img);
      setPreviewUrl(null); // drop the local preview — the processed image is now live
      setStateAndRef({ status: 'active' });
      onActivatedRef.current(img);
    },
    [setStateAndRef],
  );

  const poll = useCallback(
    async (gen: number) => {
      if (inFlightRef.current || cancelledRef.current || generationRef.current !== gen) return;
      const profileImageId = profileImageIdRef.current;
      if (!profileImageId) return;
      inFlightRef.current = true;
      try {
        const res = await getAvatarStatusAction(profileImageId);
        if (cancelledRef.current || generationRef.current !== gen) return;

        if (res.status === 'error') {
          if (res.code === 'SESSION_EXPIRED') {
            onSessionExpiredRef.current();
            return;
          }
          // Transport blip (NETWORK_ERROR / SERVER_ERROR / RATE_LIMITED): count a consecutive failure and back
          // off; after the cap, give up to timedOut (keeps the preview + a Check-again affordance).
          failuresRef.current += 1;
          if (failuresRef.current >= AVATAR_POLL_MAX_FAILURES) {
            setStateAndRef({ status: 'timedOut', attempts: attemptsRef.current });
            return;
          }
          schedulePoll(gen, pollBackoffMs(failuresRef.current));
          return;
        }

        failuresRef.current = 0; // any success resets the consecutive-failure count
        if (res.imageStatus === 'ready') {
          await activate(profileImageId, gen);
          return;
        }
        if (res.imageStatus === 'failed') {
          setPreviewUrl(null); // clear the preview — derivation failed, the user must re-pick
          setStateAndRef({ status: 'failed', reason: 'processing' });
          return;
        }
        // pending / processing → count a tick, cap out to timedOut, otherwise reschedule on the flat cadence.
        attemptsRef.current += 1;
        if (attemptsRef.current >= AVATAR_POLL_MAX_ATTEMPTS) {
          setStateAndRef({ status: 'timedOut', attempts: attemptsRef.current });
          return;
        }
        setStateAndRef({ status: 'processing', attempts: attemptsRef.current });
        schedulePoll(gen, AVATAR_POLL_INTERVAL_MS);
      } finally {
        // Generation-aware release: only clear the flag if THIS poll still owns the current attempt. A stale
        // generation's late completion must not clear a newer attempt's live in-flight flag (TOV-35 #216).
        if (generationRef.current === gen) inFlightRef.current = false;
      }
    },
    [activate, schedulePoll, setStateAndRef],
  );

  useEffect(() => {
    pollRef.current = (gen: number) => void poll(gen);
  }, [poll]);

  // The request → PUT → commit → poll pipeline for one attempt (captured generation `gen`).
  const runPipeline = useCallback(
    async (picked: File, gen: number) => {
      const key = keyRef.current;

      setStateAndRef({ status: 'requesting' });
      const reqRes = await requestAvatarUploadAction(key);
      if (cancelledRef.current || generationRef.current !== gen) return;
      if (reqRes.status === 'error') {
        if (reqRes.code === 'SESSION_EXPIRED') {
          onSessionExpiredRef.current();
          return;
        }
        setStateAndRef({
          status: 'error',
          phase: 'request',
          code: reqRes.code,
          message: reqRes.message,
        });
        return;
      }
      profileImageIdRef.current = reqRes.profileImageId;

      setStateAndRef({ status: 'uploading' });
      const controller = new AbortController();
      abortRef.current = controller;
      const upRes = await uploadToStorage(reqRes.upload, picked, controller.signal);
      if (cancelledRef.current || generationRef.current !== gen) return;
      if (!upRes.ok) {
        setStateAndRef({
          status: 'error',
          phase: 'upload',
          code: 'UPLOAD_FAILED',
          message: upRes.message,
        });
        return;
      }

      setStateAndRef({ status: 'committing' });
      const commitRes = await commitAvatarAction(reqRes.profileImageId, key);
      if (cancelledRef.current || generationRef.current !== gen) return;
      if (commitRes.status === 'error') {
        if (commitRes.code === 'SESSION_EXPIRED') {
          onSessionExpiredRef.current();
          return;
        }
        setStateAndRef({
          status: 'error',
          phase: 'commit',
          code: commitRes.code,
          message: commitRes.message,
        });
        return;
      }

      // 409 ALREADY_COMMITTED is absorbed into commit's success arm (idempotent replay), so a success here may
      // already be ready/failed — branch before polling.
      if (commitRes.imageStatus === 'ready') {
        await activate(reqRes.profileImageId, gen);
        return;
      }
      if (commitRes.imageStatus === 'failed') {
        setPreviewUrl(null);
        setStateAndRef({ status: 'failed', reason: 'processing' });
        return;
      }
      attemptsRef.current = 0;
      failuresRef.current = 0;
      setStateAndRef({ status: 'processing', attempts: 0 });
      schedulePoll(gen, AVATAR_POLL_INTERVAL_MS);
    },
    [activate, schedulePoll, setStateAndRef],
  );

  const selectFile = useCallback(
    async (picked: File) => {
      // Claim this attempt SYNCHRONOUSLY, before the async pre-flight, so pick ORDER decides the winner, not
      // decode order (#218): a later pick bumps the generation immediately, invalidating an earlier pick whose
      // pre-flight is still resolving, and it also supersedes a pending removal. Every continuation below then
      // re-checks the generation, so a superseded pick no-ops like every other stale continuation.
      const gen = resetAttempt();
      abortRef.current?.abort();
      clearPollTimer();

      // Sync schema gate (size / non-empty / MIME allowlist) then the async magic-byte + decode pre-flight.
      const parsed = profileImageFileSchema.safeParse(picked);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? AVATAR_PIPELINE_MESSAGES.UPLOAD_FAILED;
        setStateAndRef({ status: 'error', phase: 'upload', code: 'UPLOAD_FAILED', message });
        return;
      }
      const pre = await preflightImage(picked);
      if (cancelledRef.current || generationRef.current !== gen) return;
      if (!pre.ok) {
        setStateAndRef({
          status: 'error',
          phase: 'upload',
          code: 'UPLOAD_FAILED',
          message: pre.message,
        });
        return;
      }

      setPreviewUrl(pre.previewUrl); // downscaled preview built from the single decode in preflightImage
      await runPipeline(picked, gen);
    },
    [clearPollTimer, resetAttempt, runPipeline, setStateAndRef],
  );

  // From timedOut: resume polling the SAME profileImageId (never re-upload) — reset the counters and re-arm.
  // From error/failed: reset to idle so the user re-picks a file.
  const retry = useCallback(() => {
    const s = stateRef.current;
    if (s.status === 'timedOut') {
      if (!profileImageIdRef.current) return;
      attemptsRef.current = 0;
      failuresRef.current = 0;
      clearPollTimer();
      const gen = generationRef.current;
      setStateAndRef({ status: 'processing', attempts: 0 });
      schedulePoll(gen, AVATAR_POLL_INTERVAL_MS);
      return;
    }
    if (s.status === 'error' || s.status === 'failed') {
      resetAttempt(); // bump generation so any lingering continuation is inert
      clearPollTimer();
      setPreviewUrl(null);
      setStateAndRef({ status: 'idle' });
    }
  }, [clearPollTimer, resetAttempt, schedulePoll, setStateAndRef]);

  const removeAvatar = useCallback(async () => {
    const gen = resetAttempt();
    abortRef.current?.abort();
    clearPollTimer();
    setPreviewUrl(null);
    setStateAndRef({ status: 'removing' });
    const res = await setAvatarAction(null);
    if (cancelledRef.current || generationRef.current !== gen) return;
    if (res.status === 'error') {
      if (res.code === 'SESSION_EXPIRED') {
        onSessionExpiredRef.current();
        return;
      }
      setStateAndRef({ status: 'error', phase: 'activate', code: res.code, message: res.message });
      return;
    }
    setActiveImage(null);
    setStateAndRef({ status: 'idle' });
    onActivatedRef.current(null);
  }, [clearPollTimer, resetAttempt, setStateAndRef]);

  // Arm the post-unmount setState guard (body) and tear down timers/aborts on unmount.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      clearPollTimer();
      abortRef.current?.abort();
    };
  }, [clearPollTimer]);

  // Revoke the preview URL when it changes or on unmount. The URL is produced by preflightImage (a downscaled
  // data: URL, or an object-URL fallback) from the single decode, and set directly on select. revokeObjectURL
  // is a no-op for a data: URL and frees the blob for the object-URL fallback path — so this is safe either way.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return { state, previewUrl, activeImage, selectFile, removeAvatar, retry };
}
