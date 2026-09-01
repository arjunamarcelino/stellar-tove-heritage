'use client';

import { useMemo } from 'react';
import { useCountdown } from '@/hooks/useCountdown';
import type { Offering, OfferingUiState } from '@/lib/types/api';

// The subscription-window countdown (TOV-157 / FR-05.03, WS-F). Two facets that must never fork:
//   • a VISUAL segmented d/h/m/s readout that ticks once a second — `aria-hidden`, `tabular-nums`, fixed-width
//     so digits flip in place rather than reflowing;
//   • a STATIC, non-ticking spoken line ("Opens …" / "Closes …") that is the accessible name — a live
//     per-second announcement would flood a screen reader, so the absolute date carries the meaning instead
//     (a11y G10). The date is formatted deterministically with a module-scoped UTC Intl formatter so SSR and
//     the first client paint agree.
// Phase comes from the parent's `uiState` (server-authoritative, AC-13), never the local clock: `coming-soon`
// counts toward windowOpenAt; a live offering counts toward windowCloseAt; `closed`/`canceled` render nothing.

const SPOKEN_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const CLOSING_SOON_MS = 30_000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function Segment({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="inline-flex flex-col items-center">
      <span className="w-8 text-center font-heading text-2xl tabular-nums text-umber">
        {pad2(value)}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-charcoal/50">{unit}</span>
    </span>
  );
}

export default function OfferingCountdown({
  offering,
  uiState,
}: {
  offering: Offering;
  uiState: OfferingUiState;
}) {
  const isComingSoon = uiState === 'coming-soon';
  const target = isComingSoon ? offering.windowOpenAt : offering.windowCloseAt;
  // Hooks are called unconditionally (rules of hooks) before any early return. `spoken` is memoized (todo 154):
  // `target` is constant, so the Intl.format — the priciest call in the per-second path — shouldn't re-run each tick.
  const { days, hours, minutes, seconds, totalMs, expired } = useCountdown(target);
  const spoken = useMemo(
    () => `${isComingSoon ? 'Opens' : 'Closes'} ${SPOKEN_DATE_FMT.format(new Date(target))}`,
    [isComingSoon, target],
  );

  // Nothing meaningful to count for a settled/subscribed or canceled offering.
  if (uiState === 'closed' || uiState === 'canceled') return null;
  // Sienna "closing soon" buffer in the final ~30s of a live window (G13). Never for a coming-soon countdown.
  const closingSoon = !isComingSoon && !expired && totalMs > 0 && totalMs <= CLOSING_SOON_MS;

  const segments = [
    ...(days > 0 ? [{ value: days, unit: 'day' }] : []),
    { value: hours, unit: 'hr' },
    { value: minutes, unit: 'min' },
    { value: seconds, unit: 'sec' },
  ];

  return (
    <div className="mt-2">
      {/* The accessible name: a static absolute date, deterministic across SSR/hydration. */}
      <span className="sr-only">{spoken}</span>
      <div aria-hidden="true" className="flex items-center gap-3">
        {closingSoon ? (
          <span className="font-heading text-lg font-medium text-sienna">Closing soon</span>
        ) : (
          <span className="text-xs uppercase tracking-wide text-charcoal/50">
            {isComingSoon ? 'Opens in' : 'Closes in'}
          </span>
        )}
        <div className="flex items-center gap-2">
          {segments.map((s) => (
            <Segment key={s.unit} value={s.value} unit={s.unit} />
          ))}
        </div>
      </div>
    </div>
  );
}
