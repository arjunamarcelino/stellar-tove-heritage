import { quoteGateVerdict } from '@/lib/quote/status';
import { shortId } from '@/lib/quote/format';
import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import QuoteGateCta from './QuoteGateCta';
import QuotePanel from './QuotePanel';
import RetryButton from '@/components/ui/RetryButton';

// The quote submission surface (TOV-176 / FR-06.03). A Server Component dispatcher — only QuotePanel (and below)
// is 'use client'. Computes the gate verdict from raw viewer booleans (mirrors RfqSection's contract) and
// dispatches: gate CTA (sign-in / KYC) | neutral load-error retry (C7 — a failed whitelist read must NOT read as
// "complete KYC") | the panel. The authoritative (truncated) rfqId is always shown so the holder can sanity-check
// the target — context comes from the URL only (no untrusted deep-link params; C5 display block deferred to
// FR-06.02).

export default function QuoteSection({
  rfqId,
  isSignedIn,
  isWhitelisted,
  readFailed,
}: {
  rfqId: string;
  isSignedIn: boolean;
  isWhitelisted: boolean;
  readFailed?: boolean;
}) {
  const verdict = quoteGateVerdict({ isSignedIn, isWhitelisted, readFailed });

  return (
    <section aria-labelledby="quote-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 id="quote-heading" className="font-heading text-xl text-umber">
          Submit a quote
        </h1>
        <p className="text-sm text-charcoal/60">
          Offer to sell fractions into request{' '}
          <span className="tabular-nums">#{shortId(rfqId)}</span>
        </p>
      </div>

      {verdict.kind === 'gate' ? (
        <QuoteGateCta reason={verdict.reason} />
      ) : verdict.kind === 'load-error' ? (
        <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
          <p className="text-current/80">
            We couldn’t load your eligibility just now. Please refresh and try again.
          </p>
          <RetryButton />
        </div>
      ) : (
        <QuotePanel rfqId={rfqId} />
      )}
    </section>
  );
}
