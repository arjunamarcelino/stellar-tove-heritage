import Link from 'next/link';
import type { Route } from 'next';
import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import type { RfqGateReason } from '@/lib/types/api';

// The RFQ gate (TOV-173 / FR-06.01): one quiet neutral card explaining WHY a viewer can't make an offer, with
// exactly one next step. Both reasons always have a CTA (unlike the bid gate, there's no device-probe arm).
// Mirrors components/offering/BidGateCta.

interface Gate {
  heading: string;
  body: string;
  cta: { href: Route; label: string };
}

// Exhaustive Record — a new RfqGateReason fails to compile until it's given copy + a CTA.
const GATES: Record<RfqGateReason, Gate> = {
  anon: {
    heading: 'Sign in to make offers',
    body: 'You need to be signed in to make an offer on this artwork.',
    cta: { href: '/login' as Route, label: 'Sign in' },
  },
  'not-whitelisted': {
    heading: 'Complete KYC to make offers',
    body: 'Finish identity verification to make offers on fractionalized artworks.',
    cta: { href: '/settings/kyc' as Route, label: 'Complete KYC' },
  },
};

export default function RfqGateCta({ reason }: { reason: RfqGateReason }) {
  const gate = GATES[reason];
  return (
    <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
      <p className="font-heading text-base">{gate.heading}</p>
      <p className="text-current/80">{gate.body}</p>
      <Link href={gate.cta.href} className={`${PRIMARY_BUTTON} mt-2 self-start`}>
        {gate.cta.label}
      </Link>
    </div>
  );
}
