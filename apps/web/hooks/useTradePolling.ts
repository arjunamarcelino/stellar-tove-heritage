'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MyTradeResult, Trade } from '@/lib/types/api';
import {
  ACCEPT_POLL_STAGES,
  ACCEPT_POLL_JITTER_RATIO,
  ACCEPT_POLL_BACKOFF_BASE_MS,
  ACCEPT_POLL_BACKOFF_MAX_MS,
  ACCEPT_POLL_MAX_FAILURES,
} from '@/lib/accept/constants';
import { ACCEPT_MESSAGES } from '@/lib/accept/acceptMessages';

// The recurring settlement read goes through a GET route handler, not a Server Action (todo 177) — a repeating
// read shouldn't sit in React's serialized Server-Action queue behind the accept mutation. Abortable on
// unmount/hide via the caller's signal; a transport failure/abort → NETWORK_ERROR (the poll's backoff handles it,
// and cancelledRef suppresses any post-unmount setState). Returns the same MyTradeResult shape as before.
async function fetchMyTrade(rfqId: string, signal: AbortSignal): Promise<MyTradeResult> {
  try {
    const res = await fetch(`/api/marketplace/rfqs/${encodeURIComponent(rfqId)}/trade`, {
      signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      const code = res.status === 401 ? 'SESSION_EXPIRED' : 'SERVER_ERROR';
      return { status: 'error', code, message: ACCEPT_MESSAGES[code] };
    }
    return (await res.json()) as MyTradeResult;
  } catch {
    return { status: 'error', code: 'NETWORK_ERROR', message: ACCEPT_MESSAGES.NETWORK_ERROR };
  }
}

// Live polling for the caller's settling trade (TOV-178 / FR-06.04). Clones the useMyBidPolling lifecycle —
// recursive setTimeout (never setInterval), single in-flight guard, exponential backoff on a transport blip,
// terminal stop, visibility pause — with TWO deliberate divergences from that precedent (plan D4/C-5):
//   1. NO hard timeout / active-time cap: an on-chain settlement has no bounded SLA and the backend reconcile
//      guarantees a terminal state (~≤10 min), so a "timed out" message on a trade that later settles would be
//      misleading. Instead the poll interval ESCALATES by how long the trade has been pending (fast early, then
//      a slow "still settling" heartbeat), bounding request volume without ever declaring a false failure.
//   2. `failed` carries the (permissive) failureReason so the terminal affordance can route it.
//
// SESSION_EXPIRED STOPS + surfaces phase 'error' but NEVER redirects — the page/panel owns re-auth.

// A freshly-fetched trade shouldn't immediately re-poll on focus.
const UNHIDE_DEBOUNCE_MS = ACCEPT_POLL_STAGES[0]!.intervalMs;

export type TradePollPhase = 'idle' | 'polling' | 'settled' | 'failed' | 'error';

export interface UseTradePollingReturn {
  trade: Trade | null;
  phase: TradePollPhase;
  refresh: () => void;
}

function initialPhase(trade: Trade | null): TradePollPhase {
  if (!trade) return 'idle';
  if (trade.status === 'settled') return 'settled';
  if (trade.status === 'failed') return 'failed';
  return 'polling'; // pending
}

// The base interval for how long the trade has been pending (pause-excluded active time). Stages are ordered
// fast → slow; the first stage whose `untilMs` the elapsed time is below wins (the last stage is Infinity).
function stagedIntervalMs(pendingElapsedMs: number): number {
  for (const stage of ACCEPT_POLL_STAGES) {
    if (pendingElapsedMs < stage.untilMs) return stage.intervalMs;
  }
  return ACCEPT_POLL_STAGES[ACCEPT_POLL_STAGES.length - 1]!.intervalMs;
}

// Continuous ±jitter around the staged interval, per client — de-syncs many buyers polling the same settlement
// worker (browser-only hook, so Math.random is always available).
function jitteredDelayMs(pendingElapsedMs: number): number {
  const base = stagedIntervalMs(pendingElapsedMs);
  const factor = 1 + (Math.random() * 2 - 1) * ACCEPT_POLL_JITTER_RATIO;
  return Math.round(base * factor);
}

// Exponential backoff between consecutive TRANSPORT failures (429/5xx/network): 3s → 6s → 12s …, capped.
function backoffDelayMs(failures: number): number {
  return Math.min(ACCEPT_POLL_BACKOFF_BASE_MS * 2 ** (failures - 1), ACCEPT_POLL_BACKOFF_MAX_MS);
}

// The trade's real pending age at mount (ms), so the escalation reflects how long it has actually been pending
// across reloads/remounts — not just time-since-this-mount (todo 183). Only a pending seed contributes; a
// malformed/absent createdAt → 0.
function seedPendingAgeMs(seed: Trade | null): number {
  if (!seed || seed.status !== 'pending') return 0;
  const created = Date.parse(seed.createdAt);
  return Number.isNaN(created) ? 0 : Math.max(0, Date.now() - created);
}

export function useTradePolling(rfqId: string, initialTrade: Trade | null): UseTradePollingReturn {
  const [trade, setTrade] = useState<Trade | null>(initialTrade);
  const [phase, setPhase] = useState<TradePollPhase>(() => initialPhase(initialTrade));

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);
  const cancelledRef = useRef(false);
  const stoppedRef = useRef(false);
  const pollRef = useRef<() => void>(() => {});
  const lastFetchAtRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Pending-elapsed budget (pause-excluded): `activeStartRef` is the start of the current visible segment (null
  // while paused); `activeAccumRef` banks completed segments. Their sum drives the escalation (NOT a cap).
  const activeStartRef = useRef<number | null>(null);
  const activeAccumRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pendingElapsedMs = useCallback(
    () =>
      activeAccumRef.current +
      (activeStartRef.current !== null ? Date.now() - activeStartRef.current : 0),
    [],
  );

  const schedule = useCallback(
    (delayMs: number) => {
      // Bail while hidden (todo 147): a poll that resolves after the tab hides must not re-arm here and poll
      // forever in the background. The onVisibility handler re-arms on un-hide, so no poll is lost.
      if (stoppedRef.current || cancelledRef.current || document.hidden) return;
      clearTimer();
      timerRef.current = setTimeout(() => pollRef.current(), delayMs);
    },
    [clearTimer],
  );

  const poll = useCallback(async () => {
    if (inFlightRef.current || stoppedRef.current || cancelledRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const next = await fetchMyTrade(rfqId, controller.signal);
      if (cancelledRef.current) return;
      lastFetchAtRef.current = Date.now();

      if (next.status === 'error') {
        if (next.code === 'SESSION_EXPIRED') {
          stoppedRef.current = true; // stop, but NEVER redirect
          setPhase('error');
          return;
        }
        failuresRef.current += 1;
        if (failuresRef.current >= ACCEPT_POLL_MAX_FAILURES) {
          stoppedRef.current = true;
          setPhase('error');
          return;
        }
        schedule(backoffDelayMs(failuresRef.current));
        return;
      }

      failuresRef.current = 0;
      const t = next.trade;
      if (t) setTrade(t);

      if (t && t.status === 'settled') {
        stoppedRef.current = true;
        setPhase('settled');
        return;
      }
      if (t && t.status === 'failed') {
        stoppedRef.current = true;
        setPhase('failed');
        return;
      }

      // Still pending (or transiently absent) — keep polling, escalating by pending-elapsed. NO hard cap.
      setPhase('polling');
      schedule(jitteredDelayMs(pendingElapsedMs()));
    } finally {
      inFlightRef.current = false;
    }
  }, [rfqId, schedule, pendingElapsedMs]);

  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  useEffect(() => {
    cancelledRef.current = false;
    stoppedRef.current = false;
    failuresRef.current = 0;
    lastFetchAtRef.current = Date.now();
    // Seed the pending-elapsed budget from the trade's actual age (createdAt), not from mount, so a reload/remount
    // on a long-pending trade resumes at the escalated (slow) interval instead of re-hammering at the 3s stage
    // (todo 183). A malformed/absent createdAt → 0 (start fresh).
    activeAccumRef.current = seedPendingAgeMs(initialTrade);
    activeStartRef.current = document.hidden ? null : Date.now();

    if (initialTrade && initialTrade.status === 'pending') {
      schedule(jitteredDelayMs(activeAccumRef.current));
    }

    const onVisibility = () => {
      if (document.hidden) {
        if (activeStartRef.current !== null) {
          activeAccumRef.current += Date.now() - activeStartRef.current;
          activeStartRef.current = null;
        }
        clearTimer();
        abortRef.current?.abort(); // cancel an in-flight read while backgrounded
        return;
      }
      if (stoppedRef.current) return;
      activeStartRef.current = Date.now();
      if (inFlightRef.current || Date.now() - lastFetchAtRef.current < UNHIDE_DEBOUNCE_MS) {
        schedule(stagedIntervalMs(pendingElapsedMs()));
      } else {
        pollRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelledRef.current = true;
      clearTimer();
      abortRef.current?.abort(); // cancel an in-flight read on unmount
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Mount-only: `initialTrade` is the first-paint seed; later updates flow through `trade`/polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual re-arm from the terminal-but-recoverable 'error' phase. Resets the failure count + pending budget.
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

  return { trade, phase, refresh };
}
