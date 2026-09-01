import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';

// Static educational panel for the beneficiary surface (TOV-46 / FR-01.10). Always shown (empty AND
// populated states) so a Collector understands what a designation means before and after setting one. Copy
// is informational; the dynamic KYC warning (KycNoticeBanner) is separate. No PII — safe to render anywhere.
export default function InheritanceExplainer() {
  return (
    <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
      <h2 className="font-heading text-base text-charcoal">How inheritance works</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-charcoal/80">
        <li>
          Your beneficiary is who inherits your holdings. You can update or remove this designation
          at any time.
        </li>
        <li>
          If an inheritance claim is opened, there is a <strong>180-day</strong> waiting period
          before any transfer can execute.
        </li>
        <li>
          Completing your own KYC verification is required before an inheritance transfer to your
          beneficiary can be carried out — but it is <strong>not</strong> required to designate one
          now.
        </li>
      </ul>
    </div>
  );
}
