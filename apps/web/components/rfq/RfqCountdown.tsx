'use client';

import { useMemo } from 'react';
import { useCountdown } from '@/hooks/useCountdown';

// The RFQ expiry countdown (TOV-173 / FR-06.01) — an isolated ticking LEAF so only it re-renders each second,
// never the whole confirmation. Reuses the offering-agnostic useCountdown. Two facets that must never fork:
//   • a VISUAL segmented d/h/m/s readout — aria-hidden, tabular-nums, fixed-width so digits flip in place;
//   • a STATIC absolute-UTC date as the accessible name (a per-second SR announcement would flood the reader).
// "Expired" is derived client-side from expires_at vs now — the stored status may still read 'open' (no sweeper).
// role="timer" carries an implicit aria-live="off".

const SPOKEN_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

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

export default function RfqCountdown({ expiresAt }: { expiresAt: string }) {
  const { days, hours, minutes, seconds, expired, pending } = useCountdown(expiresAt);
  // target is constant, so the Intl.format (priciest per-tick call) is memoized off the ticking path.
  const spoken = useMemo(
    () => `Expires ${SPOKEN_DATE_FMT.format(new Date(expiresAt))}`,
    [expiresAt],
  );

  // `pending` guards the seeded first frame (all-zeros, expired:true) so a fresh confirmation never flashes
  // "Expired"; the live segments render during that frame, then the effect ticks in the real countdown.
  if (!pending && expired) {
    return (
      <p role="timer" className="mt-2 font-heading text-sm text-charcoal">
        <span className="sr-only">Expired — {spoken}</span>
        <span aria-hidden="true">Expired</span>
      </p>
    );
  }

  const segments = [
    ...(days > 0 ? [{ value: days, unit: 'day' }] : []),
    { value: hours, unit: 'hr' },
    { value: minutes, unit: 'min' },
    { value: seconds, unit: 'sec' },
  ];

  return (
    <div role="timer" className="mt-2">
      {/* The accessible name: a static absolute date, deterministic across renders. */}
      <span className="sr-only">{spoken}</span>
      <div aria-hidden="true" className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-charcoal/50">Expires in</span>
        <div className="flex items-center gap-2">
          {segments.map((s) => (
            <Segment key={s.unit} value={s.value} unit={s.unit} />
          ))}
        </div>
      </div>
    </div>
  );
}
