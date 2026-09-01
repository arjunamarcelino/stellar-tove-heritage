'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bid } from '@/lib/types/api';
import {
  BID_POLL_INTERVAL_MS,
  BID_POLL_JITTER_RATIO,
  BID_POLL_BACKOFF_MAX_MS,
  BID_POLL_CAP_MS,
  BID_POLL_MAX_FAILURES,
} from '@/lib/offerings/constants';
import { refreshMyBidAction } from '@/app/actions/offerings';

// Live polling for the caller's active bid (TOV-157 / FR-05.03, PERF-2). Clones the useWhitelistStatusPolling
// lifecycle — recursive setTimeout (never setInterval), single in-flight guard, exponential backoff on a
// transport blip, terminal stop, visibility pause — with three deliberate differences from that precedent:
//   1. It polls only while the seeded/last bid is `submitted`; SSR seeds lastFetchAt so a terminal or null
//      initial bid never triggers a mount refetch.
//   2. SESSION_EXPIRED STOPS + surfaces phase 'error' but NEVER redirects (AC-19) — the page/panel owns
//      re-auth; the poll hook must not navigate.
//   3. A run is capped by ACTIVE (pause-excluded) elapsed time: we accumulate wall-clock only while the tab
//      is visible and polling (banking each segment on hide, resuming on un-hide), so a backgrounded tab
//      doesn't burn the ~60s budget. Hitting the cap → phase 'timeout' (manual `refresh` re-arms it).

// UNHIDE_DEBOUNCE_MS stays local — it's derived (= the base interval), not an independent tuning knob.
const UNHIDE_DEBOUNCE_MS = BID_POLL_INTERVAL_MS; // a freshly-fetched card shouldn't re-fetch on focus

export type BidPollPhase = 'idle' | 'polling' | 'settled' | 'failed' | 'timeout' | 'error';

export interface UseMyBidPollingReturn {
  bid: Bid | null;
  phase: BidPollPhase;
  refresh: () => void;
}

function initialPhase(bid: Bid | null): BidPollPhase {
  if (!bid) return 'idle';
  if (bid.status === 'escrowed') return 'settled';
  if (bid.status === 'failed') return 'failed';
  return 'polling'; // submitted
}

// Continuous ±jitter around the base interval, per client — genuinely de-syncs bidders who submit near
// windowCloseAt (todo 147). This is a browser-only 'use client' hook, so Math.random is always available;
// an attempt-parity scheme only ever yields two values that stay in lockstep across clients.
function jitteredDelayMs(): number {
  const factor = 1 + (Math.random() * 2 - 1) * BID_POLL_JITTER_RATIO;
  return Math.round(BID_POLL_INTERVAL_MS * factor);
}

// Exponential backoff between consecutive transport failures (429/5xx/network must not be re-hit at cadence):
// 3s → 6s → 12s …, capped. `failures` is the post-increment consecutive-failure count.
function backoffDelayMs(failures: number): number {
  return Math.min(BID_POLL_INTERVAL_MS * 2 ** (failures - 1), BID_POLL_BACKOFF_MAX_MS);
}

export function useMyBidPolling(offeringId: string, initialBid: Bid | null): UseMyBidPollingReturn {
  const [bid, setBid] = useState<Bid | null>(initialBid);
  const [phase, setPhase] = useState<BidPollPhase>(() => initialPhase(initialBid));

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);
  const cancelledRef = useRef(false);
  const stoppedRef = useRef(false);
  const pollRef = useRef<() => void>(() => {});
  const lastFetchAtRef = useRef(0);
  // Active-time budget: `activeStartRef` is the wall-clock start of the current visible segment (null while
  // paused); `activeAccumRef` banks completed segments. Their sum is the pause-excluded elapsed time.
  const activeStartRef = useRef<number | null>(null);
  const activeAccumRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const activeElapsedMs = useCallback(
    () =>
      activeAccumRef.current +
      (activeStartRef.current !== null ? Date.now() - activeStartRef.current : 0),
    [],
  );

  const schedule = useCallback(
    (delayMs: number) => {
      // Also bail while the tab is hidden (todo 147): otherwise a poll that resolves after the tab hides would
      // re-arm here and poll forever in the background (the active-time cap never advances while hidden). The
      // onVisibility handler re-arms on un-hide, so no poll is lost.
      if (stoppedRef.current || cancelledRef.current || document.hidden) return;
      clearTimer();
      timerRef.current = setTimeout(() => pollRef.current(), delayMs);
    },
    [clearTimer],
  );

  const poll = useCallback(async () => {
    if (inFlightRef.current || stoppedRef.current || cancelledRef.current) return;
    inFlightRef.current = true;
    try {
      const next = await refreshMyBidAction(offeringId);
      if (cancelledRef.current) return;
      lastFetchAtRef.current = Date.now();

      if (next.status === 'error') {
        if (next.code === 'SESSION_EXPIRED') {
          // Stop, but NEVER redirect (AC-19) — the panel handles inline re-auth.
          stoppedRef.current = true;
          setPhase('error');
          return;
        }
        // Transport blip: keep the last-known bid visible, count the failure, retry with backoff — until cap.
        failuresRef.current += 1;
        if (failuresRef.current >= BID_POLL_MAX_FAILURES) {
          stoppedRef.current = true;
          setPhase('error');
          return;
        }
        schedule(backoffDelayMs(failuresRef.current));
        return;
      }

      failuresRef.current = 0;
      const b = next.bid;
      setBid(b);

      if (b && b.status === 'escrowed') {
        stoppedRef.current = true;
        setPhase('settled');
        return;
      }
      if (b && b.status === 'failed') {
        stoppedRef.current = true;
        setPhase('failed');
        return;
      }

      // Still submitted (or transiently absent) — keep polling unless the active-time cap is reached.
      if (activeElapsedMs() >= BID_POLL_CAP_MS) {
        stoppedRef.current = true;
        setPhase('timeout');
        return;
      }
      setPhase('polling');
      schedule(jitteredDelayMs());
    } finally {
      inFlightRef.current = false;
    }
  }, [offeringId, schedule, activeElapsedMs]);

  // Keep the ref the scheduler/visibility handler calls pointed at the latest poll closure.
  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  // Mount: arm polling only when the SSR-seeded bid is still submitted, wire the visibility pause/resume, and
  // treat the first-paint data as "just fetched" (no immediate refetch). Terminal/null seeds schedule nothing.
  useEffect(() => {
    cancelledRef.current = false;
    stoppedRef.current = false;
    failuresRef.current = 0;
    lastFetchAtRef.current = Date.now();
    activeAccumRef.current = 0;
    activeStartRef.current = document.hidden ? null : Date.now();

    if (initialBid && initialBid.status === 'submitted') {
      schedule(jitteredDelayMs());
    }

    const onVisibility = () => {
      if (document.hidden) {
        // Pause: bank the current active segment and stop the timer.
        if (activeStartRef.current !== null) {
          activeAccumRef.current += Date.now() - activeStartRef.current;
          activeStartRef.current = null;
        }
        clearTimer();
        return;
      }
      if (stoppedRef.current) return;
      activeStartRef.current = Date.now(); // resume the active clock
      if (inFlightRef.current || Date.now() - lastFetchAtRef.current < UNHIDE_DEBOUNCE_MS) {
        schedule(BID_POLL_INTERVAL_MS);
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
    // Mount-only: `initialBid` is the first-paint snapshot; later updates flow through `bid`/polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual re-arm from a terminal-but-recoverable phase (timeout / error). Reset the failure count AND the
  // active-time budget so a refresh after timeout gets a fresh polling window; clearTimer keeps the single
  // polling chain invariant local.
  const refresh = useCallback(() => {
    if (cancelledRef.current || inFlightRef.current) return;
    clearTimer();
    failuresRef.current = 0;
    stoppedRef.current = false;
    activeAccumRef.current = 0;
    activeStartRef.current = document.hidden ? null : Date.now();
    setPhase('polling');
    pollRef.current();
  }, [clearTimer]);

  return { bid, phase, refresh };
}
