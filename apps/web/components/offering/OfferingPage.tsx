'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { offeringUiState, bidGateVerdict } from '@/lib/offerings/status';
import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import OfferingHeader from './OfferingHeader';
import OfferingCountdown from './OfferingCountdown';
import BidGateCta from './BidGateCta';
import BidPanel from './BidPanel';
import ActiveBidCard from './ActiveBidCard';
import type { Bid, Offering, OfferingUiState } from '@/lib/types/api';

// The offering page shell (TOV-157 / FR-05.03, WS-F). FIXED props contract — WS-G (the SSR route) wires to it,
// so do not change the shape. The header + countdown render for every viewer; the body gates on the recomputed
// uiState + the viewer's auth/whitelist/active-bid.
//
// uiState is SEEDED from the server-computed `initialUiState` (first render uses the prop → no hydration
// mismatch) and then recomputed client-side once a second from the wall clock (nowMs-in-effect). The window is
// advisory display only — the backend's prepare-time verdict is authoritative (AC-13).

function StatusMessage({ offering, uiState }: { offering: Offering; uiState: OfferingUiState }) {
  let heading: string;
  let body: string;
  if (uiState === 'coming-soon') {
    heading = 'Not open yet';
    body = 'This offering hasn’t opened for bids yet — check back when the window opens.';
  } else if (uiState === 'canceled') {
    heading = 'Offering canceled';
    body = 'This offering was canceled. No bids can be placed.';
  } else {
    // closed — distinguish a settled offering from a merely-closed one.
    heading = offering.status === 'settled' ? 'Offering settled' : 'Offering closed';
    body =
      offering.status === 'settled'
        ? 'This offering has settled. The subscription window is closed.'
        : 'The subscription window has closed. This offering is no longer accepting bids.';
  }
  return (
    <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
      <p className="font-heading text-base">{heading}</p>
      <p className="text-current/80">{body}</p>
    </div>
  );
}

export default function OfferingPage({
  offering,
  initialUiState,
  initialBid,
  isWhitelisted,
  isSignedIn,
}: {
  offering: Offering;
  initialUiState: OfferingUiState;
  initialBid: Bid | null;
  isWhitelisted: boolean;
  isSignedIn: boolean;
}) {
  const [uiState, setUiState] = useState<OfferingUiState>(initialUiState);
  // A bid placed live in this session (handed up from BidPanel). Combined with the SSR `initialBid` so
  // "an active bid wins over the gate" holds for BOTH — a window-close tick can't reclaim a just-placed bid.
  const [placedBid, setPlacedBid] = useState<Bid | null>(null);
  const activeBid = placedBid ?? initialBid;

  useEffect(() => {
    const recompute = () =>
      setUiState(
        offeringUiState(offering.status, Date.now(), offering.windowOpenAt, offering.windowCloseAt),
      );
    // Correct the seed immediately post-mount (the window may already have crossed a boundary).
    recompute();
    // Only an `opened` offering's uiState changes over time; a terminal status never needs a per-second
    // wakeup (todo 154), so don't arm the interval for it.
    if (offering.status !== 'opened') return;
    const id = setInterval(recompute, 1000);
    return () => clearInterval(id);
  }, [offering.status, offering.windowOpenAt, offering.windowCloseAt]);

  // The gate verdict is a pure fn (todo 149) — an active bid (SSR-seeded OR just placed this session) wins
  // over everything, so the escrow poll survives a window close (AC-6; todo 146).
  const verdict = bidGateVerdict(uiState, {
    hasActiveBid: activeBid !== null,
    isSignedIn,
    isWhitelisted,
  });

  let body: ReactNode;
  if (verdict.kind === 'active-bid' && activeBid !== null) {
    body = <ActiveBidCard offeringId={offering.id} initialBid={activeBid} />;
  } else if (verdict.kind === 'status') {
    body = <StatusMessage offering={offering} uiState={uiState} />;
  } else if (verdict.kind === 'gate') {
    body = <BidGateCta reason={verdict.reason} />;
  } else {
    body = <BidPanel offering={offering} onSubmitted={setPlacedBid} />;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <OfferingHeader offering={offering} uiState={uiState} />
        <OfferingCountdown offering={offering} uiState={uiState} />
      </div>
      {body}
    </div>
  );
}
