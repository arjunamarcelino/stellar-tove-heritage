import { rfqGateVerdict } from '@/lib/rfq/status';
import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import RfqGateCta from './RfqGateCta';
import RfqPanel from './RfqPanel';

// The RFQ create surface (TOV-173 / FR-06.01, WS-D). A Server Component dispatcher — only RfqPanel (and below)
// is 'use client'. Independent of the offering subscription window: the gate ladder keys only on signed-in +
// whitelisted (+ fractionalized), so the "Make an offer" CTA renders regardless of the primary sale's state.
// `fractionalized === false` proactively hides the CTA; `undefined` (the flag isn't on the payload yet) falls
// through to render-and-error on submit.

export default function RfqSection({
  artworkId,
  isSignedIn,
  isWhitelisted,
  fractionalized,
}: {
  artworkId: string;
  isSignedIn: boolean;
  isWhitelisted: boolean;
  fractionalized?: boolean;
}) {
  const verdict = rfqGateVerdict({ isSignedIn, isWhitelisted, fractionalized });

  return (
    <section aria-labelledby="rfq-heading" className="flex flex-col gap-3">
      <h2 id="rfq-heading" className="font-heading text-lg text-umber">
        Make an offer
      </h2>
      {verdict.kind === 'gate' ? (
        <RfqGateCta reason={verdict.reason} />
      ) : verdict.kind === 'unavailable' ? (
        <p className={`${TONE_CARD_BASE} ${TONE_NEUTRAL}`}>
          This artwork isn’t available for offers yet.
        </p>
      ) : (
        <RfqPanel artworkId={artworkId} />
      )}
    </section>
  );
}
