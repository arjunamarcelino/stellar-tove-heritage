'use client';

import { useState } from 'react';

type Zone = 'normal' | 'warn' | 'over';

// value.length is UTF-16 code units — an emoji (a surrogate pair) counts as 2, matching the backend limit.
function zoneOf(length: number, max: number, warnRatio: number): Zone {
  if (length > max) return 'over';
  if (length >= max * warnRatio) return 'warn';
  return 'normal';
}

function announcementFor(zone: Zone, length: number, max: number): string {
  if (zone === 'over') return `You are ${length - max} characters over the ${max} limit.`;
  if (zone === 'warn') return `Approaching the ${max} character limit.`;
  return `${max - length} characters remaining.`;
}

interface Props {
  value: string;
  max: number;
  id?: string;
  // Fraction of `max` at which the counter switches to its warning tone (default 0.9). A ui/ primitive must
  // not import a feature's lib/, so the ratio is a prop rather than a shared profile constant.
  warnRatio?: number;
}

// Live character counter for the bio/statement fields (TOV-35). The visible count updates on every
// keystroke; the SR live region does NOT — it announces ONLY when the value crosses a zone boundary
// (normal ⇄ warn ⇄ over), so a screen reader isn't spammed per character. Zone crossings are detected with
// the documented "adjust state during render when a prop changes" pattern (no effect, no extra paint).
export default function CharCounter({ value, max, id, warnRatio = 0.9 }: Props) {
  const length = value.length;
  const zone = zoneOf(length, max, warnRatio);

  const [prevZone, setPrevZone] = useState<Zone>(zone);
  const [announcement, setAnnouncement] = useState('');
  if (zone !== prevZone) {
    setPrevZone(zone);
    setAnnouncement(announcementFor(zone, length, max));
  }

  const toneClass =
    zone === 'over' ? 'text-sienna' : zone === 'warn' ? 'text-ochre' : 'text-charcoal/60';

  return (
    <>
      <span id={id} className={`text-xs tabular-nums ${toneClass}`}>
        {length} / {max}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
