'use client';

import { useSyncExternalStore } from 'react';

/**
 * A SINGLE module-level 1s ticker shared by every countdown on the page. N `useNowMs()` consumers ⇒ one
 * `setInterval`, not N — each consumer re-renders only its own leaf. The interval runs only while there
 * is ≥1 subscriber and skips work while the tab is hidden (browsers throttle background timers anyway).
 * Pure time math lives in `offering-display` (`remainingMs` / `formatCountdown`) and is unit-tested there.
 */

const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let nowMs = Date.now();

function tick(): void {
  if (typeof document !== 'undefined' && document.hidden) return; // don't churn while backgrounded
  nowMs = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (intervalId === null) intervalId = setInterval(tick, 1000);
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

const getSnapshot = (): number => nowMs;
// Stable server snapshot avoids a hydration mismatch; the client corrects on first tick.
const getServerSnapshot = (): number => 0;

/** Current epoch-ms, updated once per second from the shared ticker. */
export function useNowMs(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
