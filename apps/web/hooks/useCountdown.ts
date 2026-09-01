'use client';

import { useEffect, useRef, useState } from 'react';
import { countdownParts } from '@/lib/money/format';

// Advisory per-second countdown toward `targetIso` (TOV-157 / FR-05.03, PERF-4). Feature-neutral (renamed
// from useBidCountdown in TOV-173 once the RFQ expiry countdown became a second consumer). Leaf-owned state so
// the once-a-second re-render is isolated to the consuming countdown subtree, never a whole page.
//
// SSR/hydration parity: the clock is read ONLY inside the effect (never during render) — the same
// nowMs-in-effect idiom as WhitelistStatusCard. `nowMs` is null until the first post-mount tick, so the
// server render and the first client paint agree deterministically (seeded from the target → a neutral
// all-zeros snapshot) instead of diverging on wall-clock time; the effect corrects it within a frame.
//
// The interval re-aligns to the whole-second boundary each tick (delay = 1000 − now%1000) so digits flip on
// the second rather than drifting, the timer is cleared on unmount, and ticking stops for good once expired.

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
  totalMs: number;
  // True until the first post-mount tick reads the clock. During the seeded first frame the parts are
  // all-zeros and `expired` is true regardless of the real target, so a consumer that renders a distinct
  // "expired" state (rather than zero segments) must gate on `!pending` to avoid a one-frame flash.
  pending: boolean;
}

export function useCountdown(targetIso: string): Countdown {
  const [nowMs, setNowMs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      setNowMs(now);
      // Terminal — leave the frozen 0s snapshot and stop scheduling (no idle 1s wakeups after close).
      if (countdownParts(targetIso, now).expired) return;
      // Re-align to the next whole-second boundary so the visible digits flip on the second.
      timerRef.current = setTimeout(tick, 1000 - (now % 1000));
    };

    tick(); // seed nowMs on mount, then self-schedule

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [targetIso]);

  // Before the first effect tick, seed from the target (deterministic all-zeros) rather than the clock so
  // SSR and the first client paint match; after mount, `nowMs` drives the live value.
  return {
    ...countdownParts(targetIso, nowMs ?? new Date(targetIso).getTime()),
    pending: nowMs === null,
  };
}
