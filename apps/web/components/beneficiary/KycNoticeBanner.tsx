import { TONE_CARD_BASE, TONE_WARNING } from '@/components/ui/surfaces';
import { BENEFICIARY_NOTICE_MESSAGES } from '@/lib/beneficiary/beneficiaryMessages';
import type { BeneficiaryNotice } from '@/lib/types/api';

interface Props {
  // The stable notice code from the API (or null when the Collector is whitelisted). Keep the literal at
  // the boundary; we switch on the CODE and render our own curated copy — the backend `message` never
  // reaches the client. (The `!==` guard below stays as defense against an unexpected value.)
  code: BeneficiaryNotice['code'] | null;
}

// Dynamic, informational KYC banner (TOV-46). Renders only when the API returned a KYC_REQUIRED_FOR_TRANSFER
// notice. It NEVER blocks designating/saving — it just explains the downstream requirement. Switch on the
// stable code (not message text); an unknown/absent code renders nothing.
export default function KycNoticeBanner({ code }: Props) {
  if (code !== 'KYC_REQUIRED_FOR_TRANSFER') return null;

  return (
    <div className={`${TONE_CARD_BASE} ${TONE_WARNING}`} role="status">
      <p>{BENEFICIARY_NOTICE_MESSAGES.KYC_REQUIRED_FOR_TRANSFER}</p>
    </div>
  );
}
