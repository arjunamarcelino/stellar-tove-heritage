import Link from 'next/link';
import type { Route } from 'next';
import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import type { QuoteGateReason } from '@/lib/types/api';

// The quote gate (TOV-176 / FR-06.03): one quiet neutral card explaining WHY a viewer can't submit a quote,
// with exactly one next step. Mirrors RfqGateCta. Also reused as the QUOTE_NOT_WHITELISTED backstop affordance
// in the panel.

interface Gate {
  heading: string;
  body: string;
  cta: { href: Route; label: string };
}

// Exhaustive Record — a new QuoteGateReason fails to compile until it's given copy + a CTA.
const GATES: Record<QuoteGateReason, Gate> = {
  anon: {
    heading: 'Sign in to submit a quote',
    body: 'You need to be signed in to respond to a request for quotes.',
    cta: { href: '/login', label: 'Sign in' },
  },
  'not-whitelisted': {
    heading: 'Complete KYC to submit a quote',
    body: 'Finish identity verification to sell fractions on the marketplace.',
    cta: { href: '/settings/kyc', label: 'Complete KYC' },
  },
};

export default function QuoteGateCta({ reason }: { reason: QuoteGateReason }) {
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
