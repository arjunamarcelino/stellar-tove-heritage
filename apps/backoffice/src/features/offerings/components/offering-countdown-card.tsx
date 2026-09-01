'use client';

import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useNowMs } from '@/hooks/use-countdown';
import { dateTimeFormatter } from '@/lib/date-format';

import { useOfferings } from '../hooks/use-offering-queries';
import { formatCountdown, remainingMs } from '../offering-display';

/**
 * The only node that subscribes to the shared 1s ticker — so each tick re-renders just this `<time>`
 * text, not the whole card/rows. `role="timer"` (implicit `aria-live: off`) lives on the wrapping span
 * in the card so per-second ticks aren't announced.
 */
function CountdownText({ target }: { target: string }) {
  const now = useNowMs();
  return <time dateTime={target}>{formatCountdown(remainingMs(target, now))}</time>;
}

/**
 * Dashboard card: approved offerings with a live countdown to `windowOpenAt`. Hidden entirely when there
 * are none. The card itself does NOT subscribe to the ticker (only the `CountdownText` leaves do), and
 * the SR label is computed once per row via the shared `dateTimeFormatter` (not per tick).
 */
export function OfferingCountdownCard() {
  const { data } = useOfferings({ status: 'approved', limit: 5 });
  const approved = data?.data ?? [];

  if (approved.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Approved offerings</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {approved.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2">
              <Link href={`/offerings/${o.id}`} className="font-mono text-xs hover:underline">
                {o.id.slice(0, 8)}
              </Link>
              <span
                role="timer"
                aria-label={`Window opens ${dateTimeFormatter.format(new Date(o.windowOpenAt))}`}
                className="text-sm tabular-nums text-muted-foreground"
              >
                <CountdownText target={o.windowOpenAt} />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
