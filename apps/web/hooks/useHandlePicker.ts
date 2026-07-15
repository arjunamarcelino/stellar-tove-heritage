'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { handleSchema } from '@/lib/handle/schemas';
import { checkHandle } from '@/lib/handle/checkHandle';
import { HANDLE_MESSAGES } from '@/lib/handle/handleMessages';
import { setHandleAction } from '@/app/actions/handle';
import { ONBOARDING_NEXT_PATH } from '@/lib/constants';
import type { HandlePickerState, UseHandlePickerReturn } from '@/lib/types/api';

const DEBOUNCE_MS = 400;

// Drives the handle picker: local schema gate → debounced live availability check → commit. The
// availability check is a DIRECT browser fetch (checkHandle) so the backend's per-IP throttle keys on
// the real client IP; the commit goes through a Server Action (needs the httpOnly cookie).
//
// Concurrency is the hard part (mirrors useWalletExport's ref discipline):
//  • seqRef  — monotonic token; every onChange bumps it. A check's result is applied ONLY if its
//    captured seq is still current. This — not `status: 0` — decides dropped-vs-failed: an aborted
//    (superseded) check reports NETWORK_ERROR too, but its seq is stale so it's dropped, never shown.
//  • checkAbortRef — aborts the in-flight fetch on each new keystroke (reclaims throttle budget).
//  • debounceTimerRef — cleared on each keystroke AND on unmount (or a timer fires post-unmount).
//  • busyRef — submit mutex (no double-commit). committedRef/cancelledRef — suppress late resolvers.
// Only `unavailable` verdicts are cached (taken/reserved are stable); `available` is deliberately not
// cached (it can go stale — the authoritative POST + 409 handles that race).
export function useHandlePicker(): UseHandlePickerReturn {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [state, setState] = useState<HandlePickerState>({ status: 'idle' });
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  const committedRef = useRef(false);
  const seqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkAbortRef = useRef<AbortController | null>(null);
  const isComposingRef = useRef(false);
  const verdictCache = useRef<Map<string, HandlePickerState>>(new Map());

  // Arm/disarm the unmount guard and clear any dangling timer/abort so nothing fires after unmount.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      checkAbortRef.current?.abort();
    };
  }, []);

  const runCheck = useCallback(
    async (handle: string) => {
      const mySeq = seqRef.current;
      const controller = new AbortController();
      checkAbortRef.current = controller;
      setState({ status: 'checking' });

      const result = await checkHandle(handle, controller.signal);

      // Stale-drop: only the latest keystroke's result may update state. A superseded (aborted) check
      // has a stale seq and is dropped here — its NETWORK_ERROR must never surface.
      if (cancelledRef.current || committedRef.current || mySeq !== seqRef.current) return;

      if (result.status === 'available') {
        setState({ status: 'available' });
      } else if (result.status === 'unavailable') {
        const next: HandlePickerState = {
          status: 'unavailable',
          reason: result.reason,
          message: HANDLE_MESSAGES[result.reason],
        };
        verdictCache.current.set(handle, next);
        setState(next);
      } else {
        // Genuine transport error on the current value.
        setState({
          status: 'error',
          code: result.code,
          message: HANDLE_MESSAGES[result.code],
        });
      }
    },
    [setState],
  );

  const onChange = useCallback(
    (raw: string) => {
      setValue(raw);
      if (isComposingRef.current) return; // wait for compositionend

      // Invalidate any pending timer + in-flight check synchronously, before any async work.
      seqRef.current++;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      checkAbortRef.current?.abort();
      checkAbortRef.current = null;

      if (raw.trim() === '') {
        setState({ status: 'idle' });
        return;
      }

      const parsed = handleSchema.safeParse(raw);
      if (!parsed.success) {
        setState({
          status: 'invalid',
          message: parsed.error.issues[0]?.message ?? 'Invalid handle',
        });
        return;
      }
      const handle = parsed.data;

      const cached = verdictCache.current.get(handle);
      if (cached) {
        setState(cached);
        return;
      }

      setState({ status: 'debouncing' });
      debounceTimerRef.current = setTimeout(() => {
        void runCheck(handle);
      }, DEBOUNCE_MS);
    },
    [runCheck, setState],
  );

  const onCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(
    (raw: string) => {
      isComposingRef.current = false;
      onChange(raw);
    },
    [onChange],
  );

  const submit = useCallback(async () => {
    if (busyRef.current) return;

    const parsed = handleSchema.safeParse(value);
    if (!parsed.success) {
      setState({ status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid handle' });
      return;
    }

    // Force-check-skip: the POST is authoritative, so drop any pending/in-flight check and commit.
    seqRef.current++;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    checkAbortRef.current?.abort();

    busyRef.current = true;
    setState({ status: 'submitting' });
    try {
      // On success the action server-redirects (throws NEXT_REDIRECT) — we only reach the branches
      // below on an error result. Do NOT wrap this in a catch that swallows the redirect.
      const result = await setHandleAction(parsed.data);
      if (cancelledRef.current) return;

      if (result.status === 'error') {
        if (result.code === 'HANDLE_TAKEN') {
          // TOCTOU: someone claimed it between the green check and our commit.
          const next: HandlePickerState = {
            status: 'unavailable',
            reason: 'taken',
            message: HANDLE_MESSAGES.taken,
          };
          verdictCache.current.set(parsed.data, next);
          setState(next);
        } else {
          setState({
            status: 'error',
            code: result.code,
            message: result.message,
          });
        }
      } else {
        // Success normally never reaches here — the action server-redirects (throws NEXT_REDIRECT).
        // If it ever returns success without redirecting, navigate client-side so the user isn't
        // stranded in `submitting` (belt-and-suspenders). committedRef suppresses any late resolvers.
        committedRef.current = true;
        router.replace(ONBOARDING_NEXT_PATH);
      }
    } finally {
      busyRef.current = false;
    }
  }, [value, setState, router]);

  return { value, state, onChange, onCompositionStart, onCompositionEnd, submit };
}
