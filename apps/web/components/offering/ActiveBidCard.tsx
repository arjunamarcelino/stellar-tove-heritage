'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMyBidPolling, type BidPollPhase } from '@/hooks/useMyBidPolling';
import {
  TONE_CARD_BASE,
  TONE_NEUTRAL,
  TONE_ACCENT,
  TONE_DESTRUCTIVE,
  MUTED_LINK,
} from '@/components/ui/surfaces';
import type { Bid } from '@/lib/types/api';

// The active-bid card (TOV-157 / FR-05.03, WS-F). Owns the escrow poll (useMyBidPolling) once the bid has been
// submitted — the parent hands off here. Per-phase tone follows the brand: escrowing = neutral (charcoal),
// placed = ochre (TONE_ACCENT, the single success/live accent — never green), failed = sienna
// (TONE_DESTRUCTIVE — never red). Semantics ride on the heading, not colour (a11y G10).
//
// A11y: one persistent sr-only role=status/aria-live=polite announces coarse transitions only. On a terminal
// phase, focus moves to the result heading, then the announcement fires a frame later (rAF) so the SR speech
// queue drains in order (focus otherwise preempts a polite announcement queued in the same commit) — the
// HoldingsWidget idiom.

// Middle-truncate a long on-chain hash so both ends stay legible without wrapping the receipt line.
function middleTruncate(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

const ANNOUNCE: Record<BidPollPhase, string> = {
  idle: 'Your bid is being escrowed.',
  polling: 'Your bid is being escrowed.',
  settled: 'Your bid is placed.',
  failed: 'Your bid failed. No funds were moved.',
  timeout: 'Your bid is still settling. Refresh to check again.',
  error: 'We couldn’t confirm your bid. Refresh to try again.',
};

function isTerminal(phase: BidPollPhase): boolean {
  return phase === 'settled' || phase === 'failed' || phase === 'timeout' || phase === 'error';
}

export default function ActiveBidCard({
  offeringId,
  initialBid,
}: {
  offeringId: string;
  initialBid: Bid;
}) {
  const { bid, phase, refresh } = useMyBidPolling(offeringId, initialBid);

  const headingRef = useRef<HTMLParagraphElement>(null);
  const [announce, setAnnounce] = useState('');
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  // Defer every announce by a frame (rAF) so it can't preempt the focus move on a terminal phase; on a
  // terminal phase, move focus to the result heading first. Routing all announces through rAF also keeps
  // setState out of the effect body (no react-hooks/set-state-in-effect).
  useEffect(() => {
    if (isTerminal(phase)) headingRef.current?.focus();
    const raf = requestAnimationFrame(() => {
      if (aliveRef.current) setAnnounce(ANNOUNCE[phase]);
    });
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  let tone: string;
  let heading: string;
  let body: ReactNode;

  if (phase === 'settled') {
    tone = TONE_ACCENT;
    heading = 'Bid placed';
    body = (
      <div className="space-y-1">
        <p>Your USDC is locked in escrow.</p>
        {bid && bid.status === 'escrowed' ? (
          <dl className="mt-1 space-y-0.5 text-xs tabular-nums text-current/70">
            {bid.chainBidId !== null ? (
              <div className="flex gap-2">
                <dt className="text-current/50">Bid</dt>
                <dd>#{bid.chainBidId}</dd>
              </div>
            ) : null}
            {bid.escrowTxHash ? (
              <div className="flex gap-2">
                <dt className="text-current/50">Escrow tx</dt>
                <dd className="font-mono">{middleTruncate(bid.escrowTxHash)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    );
  } else if (phase === 'failed') {
    tone = TONE_DESTRUCTIVE;
    heading = 'Bid failed — No funds were moved';
    body = <p>Your bid couldn’t be placed. Please try again.</p>;
  } else if (phase === 'timeout') {
    tone = TONE_NEUTRAL;
    heading = 'Still settling';
    body = (
      <p>
        This is taking longer than usual.{' '}
        <button type="button" onClick={refresh} className={MUTED_LINK}>
          Refresh
        </button>
      </p>
    );
  } else if (phase === 'error') {
    tone = TONE_NEUTRAL;
    heading = 'Couldn’t confirm your bid';
    body = (
      <p>
        We couldn’t reach the server.{' '}
        <button type="button" onClick={refresh} className={MUTED_LINK}>
          Refresh
        </button>
      </p>
    );
  } else {
    // idle / polling — the escrow is in flight.
    tone = TONE_NEUTRAL;
    heading = 'Escrowing…';
    body = <p>We’re locking your USDC into escrow. This usually takes a few seconds.</p>;
  }

  const showPulse = phase === 'idle' || phase === 'polling';

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className={`${TONE_CARD_BASE} ${tone} flex-col`}>
        <p
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-2 font-heading text-base"
        >
          {showPulse ? (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-charcoal/50 motion-safe:animate-pulse"
            />
          ) : null}
          {heading}
        </p>
        <div className="text-current/80">{body}</div>
      </div>
    </div>
  );
}
