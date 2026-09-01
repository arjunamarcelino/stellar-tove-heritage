'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { formatUsdc } from '@/lib/money/format';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { TONE_CARD_BASE, TONE_WARNING } from '@/components/ui/surfaces';
import { MONEY_FIGURE } from '@/components/ui/typography';
import { shortId } from '@/lib/quote/format';
import QuoteCountdown from './QuoteCountdown';
import type { Quote } from '@/lib/types/api';

// The quote submission confirmation (TOV-176 / FR-06.03). Static parent: the ticking countdown lives in the
// QuoteCountdown leaf so this subtree doesn't re-render each second. On mount, focus moves to the heading (a
// clear "you are here" landing) — NOT wrapped in a live region (that would double-announce, C8/R5.1). The
// countdown + capped notice bind to the SERVER-returned quote.validUntil / quote.validUntilCapped, never the
// client-frozen input (R4.2): a capped quote shows the capped instant, a replay shows the stored one. Sell-side
// language — amounts are what the holder would RECEIVE, never "you pay".

export default function QuoteConfirmation({
  quote,
  onSubmitAnother,
}: {
  quote: Quote;
  onSubmitAnother: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // price × count total, exact BigInt on the SERVER-returned string count (never Number(count) — R4.3).
  const proceeds = formatUsdc(
    (BigInt(quote.pricePerFractionStroops) * BigInt(quote.fractionCount)).toString(),
  );

  return (
    // data-quote-id carries the FULL id (the visible chip is truncated) so a DOM-driving agent can read back
    // the created resource to chain a follow-up.
    <div className="flex flex-col gap-3" data-quote-id={quote.id}>
      <h2 ref={headingRef} tabIndex={-1} className="font-heading text-lg text-umber outline-none">
        Quote submitted
      </h2>
      <span className="inline-flex w-fit items-center rounded-full bg-ochre/15 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-umber">
        {quote.status}
      </span>
      <dl className="flex flex-col gap-1 text-sm text-charcoal">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-charcoal/60">Quote ID</dt>
          <dd className={MONEY_FIGURE}>#{shortId(quote.id)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-charcoal/60">Price per fraction</dt>
          <dd className={MONEY_FIGURE}>{formatUsdc(quote.pricePerFractionStroops)} USDC</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-charcoal/60">Fractions offered</dt>
          <dd className={MONEY_FIGURE}>{quote.fractionCount}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-charcoal/60">You’d receive if filled</dt>
          <dd className={MONEY_FIGURE}>{proceeds} USDC</dd>
        </div>
      </dl>

      <QuoteCountdown validUntil={quote.validUntil} />

      {quote.validUntilCapped ? (
        <p role="status" className={`${TONE_CARD_BASE} ${TONE_WARNING}`}>
          Heads up — this request closes soon, so your quote was shortened to be valid only until
          the request’s expiry. It was still submitted.
        </p>
      ) : null}

      <div className="mt-1 flex gap-3">
        <button type="button" onClick={onSubmitAnother} className={PRIMARY_BUTTON}>
          Submit another
        </button>
        <Link href="/dashboard" className={SECONDARY_BUTTON}>
          Done
        </Link>
      </div>
    </div>
  );
}
