import Link from 'next/link';
import type { Route } from 'next';
import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import { OFFERINGS_MESSAGES } from '@/lib/offerings/offeringsMessages';
import { OFFERING_PRIMARY_BUTTON } from './constants';
import type { BidGateReason } from '@/lib/types/api';

// The bid gate (TOV-157 / FR-05.03, WS-F): one quiet neutral card that explains WHY a viewer can't bid and
// offers exactly one next step. `unsupported` (no passkey-capable device) gets an honest explanation and NO
// CTA — a dead button would be worse than none (G8). Enrol deep-links to /settings via the canonical `as Route`
// cast (the passkey-enrol surface lives under settings).

const ENROL_HREF = '/settings' as Route;

interface Gate {
  heading: string;
  body: string;
  cta: { href: Route; label: string } | null;
}

// Exhaustive Record — a new BidGateReason fails to compile until it's given copy + a CTA decision.
const GATES: Record<BidGateReason, Gate> = {
  anon: {
    heading: 'Sign in to bid',
    body: 'You need to be signed in to place a bid on this offering.',
    cta: { href: '/login' as Route, label: 'Sign in' },
  },
  'not-whitelisted': {
    heading: 'Complete verification to bid',
    body: OFFERINGS_MESSAGES.BID_NOT_WHITELISTED,
    cta: { href: '/settings/kyc' as Route, label: 'Complete KYC' },
  },
  'no-passkey': {
    heading: 'Enrol a passkey to bid',
    body: OFFERINGS_MESSAGES.WALLET_NOT_FOUND,
    cta: { href: ENROL_HREF, label: 'Enrol a passkey' },
  },
  unsupported: {
    heading: 'Bidding needs a passkey',
    body: OFFERINGS_MESSAGES.PASSKEY_UNSUPPORTED,
    cta: null,
  },
  // Mid-flow the session lapsed. Same neutral-card shape as the gates (todo 151 dedup) — BidPanel stays
  // mounted behind it, so the entered price/count survive re-auth (G9).
  'session-expired': {
    heading: 'Session expired',
    body: OFFERINGS_MESSAGES.SESSION_EXPIRED,
    cta: { href: '/login' as Route, label: 'Sign in' },
  },
};

export default function BidGateCta({ reason }: { reason: BidGateReason }) {
  const gate = GATES[reason];
  return (
    <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
      <p className="font-heading text-base">{gate.heading}</p>
      <p className="text-current/80">{gate.body}</p>
      {gate.cta ? (
        <Link href={gate.cta.href} className={`${OFFERING_PRIMARY_BUTTON} mt-2 self-start`}>
          {gate.cta.label}
        </Link>
      ) : null}
    </div>
  );
}
