'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WhitelistStatusResult } from '@/lib/types/api';
import {
  WHITELIST_POLL_INTERVAL_MS,
  WHITELIST_POLL_MAX_FAILURES,
  WHITELIST_POLL_BACKOFF_MAX_MS,
  WHITELIST_UNHIDE_DEBOUNCE_MS,
} from '@/lib/kyc/constants';
import { refreshWhitelistStatusAction } from '@/app/actions/kyc';

// Live polling for the FR-01.08 whitelist card. The server component supplies the initial result (SSR
// first paint — no loading flash); this hook keeps it current while pending_review. Mirrors the codebase's
// ref-guarded async pattern (busyRef/cancelledRef in useKycSubmission): setState only ever happens inside
// an async callback, never synchronously in an effect body.
//
// Lifecycle rules (TOV-45 SpecFlow):
// - Poll only while pending_review (or to recover from an initial transport error); stop the instant a
//   response is any terminal state — polling never restarts within a page load.
// - Recursive setTimeout (not setInterval) + single in-flight guard: a slow action can't overlap ticks.
// - SESSION_EXPIRED → stop + redirect to /login (no infinite loop).
// - Keep the last-known-good state on a transport error; retry with EXPONENTIAL BACKOFF, and after N
//   consecutive failures stop and go degraded (a manual retry re-arms). Any success resets the failure count.
// - Pause while the tab is hidden; on un-hide, refresh once immediately then resume.

function isPendingReview(result: WhitelistStatusResult): boolean {
  return result.status === 'success' && result.data.status === 'pending_review';
}

// Exponential backoff between consecutive transport failures (429/5xx must not be re-hit at the fixed 5 s
// cadence): 5s → 10s → 20s → 40s …, capped. `failures` is the post-increment consecutive-failure count.
function backoffDelayMs(failures: number): number {
  return Math.min(WHITELIST_POLL_INTERVAL_MS * 2 ** (failures - 1), WHITELIST_POLL_BACKOFF_MAX_MS);
}

export function useWhitelistStatusPolling(initial: WhitelistStatusResult) {
  const [result, setResult] = useState<WhitelistStatusResult>(initial);
  const [degraded, setDegraded] = useState(false);
  const router = useRouter();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);
  const cancelledRef = useRef(false);
  const stoppedRef = useRef(false);
  const pollRef = useRef<() => void>(() => {});
  // Timestamp of the last completed fetch (seeded at mount to the SSR first-paint time) — powers the un-hide
  // debounce so a freshly-loaded/just-fetched card doesn't re-fetch on focus.
  const lastFetchAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (delayMs: number = WHITELIST_POLL_INTERVAL_MS) => {
      if (stoppedRef.current || cancelledRef.current) return;
      clearTimer();
      timerRef.current = setTimeout(() => pollRef.current(), delayMs);
    },
    [clearTimer],
  );

  const poll = useCallback(async () => {
    if (inFlightRef.current || stoppedRef.current || cancelledRef.current) return;
    inFlightRef.current = true;
    try {
      const next = await refreshWhitelistStatusAction();
      if (cancelledRef.current) return;
      lastFetchAtRef.current = Date.now();

      if (next.status === 'error') {
        if (next.code === 'SESSION_EXPIRED') {
          stoppedRef.current = true;
          router.replace('/login');
          return;
        }
        // Transport blip: keep the last-known state visible, count the failure, retry with backoff — until
        // the cap. Backing off means a 429/5xx (which collapses to SERVER_ERROR here) isn't re-hit at 5 s.
        failuresRef.current += 1;
        if (failuresRef.current >= WHITELIST_POLL_MAX_FAILURES) {
          stoppedRef.current = true;
          setDegraded(true);
          return;
        }
        schedule(backoffDelayMs(failuresRef.current));
        return;
      }

      failuresRef.current = 0;
      setDegraded(false);
      setResult(next);
      if (next.data.status === 'pending_review') schedule();
      else stoppedRef.current = true; // terminal — stop for good
    } finally {
      inFlightRef.current = false;
    }
  }, [router, schedule]);

  // Keep the ref the scheduler/visibility handler calls pointed at the latest poll closure.
  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  // Mount: arm polling if we start pending (or need to recover from an initial error), plus the tab
  // visibility pause/resume. Terminal initial states never schedule anything.
  useEffect(() => {
    cancelledRef.current = false;
    stoppedRef.current = false;
    failuresRef.current = 0;
    lastFetchAtRef.current = Date.now(); // treat the SSR first-paint data as "just fetched"

    if (isPendingReview(initial) || initial.status === 'error') schedule();

    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
        return;
      }
      if (stoppedRef.current) return;
      // A poll is already running: don't stack — just make sure a tick is armed so a dropped immediate
      // refresh can't stall polling. Recently fetched: wait one interval instead of an off-cadence hit.
      // Otherwise refresh now (then poll reschedules itself).
      if (
        inFlightRef.current ||
        Date.now() - lastFetchAtRef.current < WHITELIST_UNHIDE_DEBOUNCE_MS
      ) {
        schedule();
      } else {
        pollRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelledRef.current = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Mount-only: `initial` is the first-paint snapshot; later updates flow through `result`/polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual re-arm from the degraded state (user taps "retry"). clearTimer first so the "single polling
  // chain" invariant is local — retry can never leave a stale timer racing the fresh poll.
  const retry = useCallback(() => {
    if (cancelledRef.current || inFlightRef.current) return;
    clearTimer();
    failuresRef.current = 0;
    stoppedRef.current = false;
    setDegraded(false);
    pollRef.current();
  }, [clearTimer]);

  return { result, degraded, retry } as const;
}
