'use client';

import type { KycDocType } from '@/lib/types/api';
import { KYC_ALLOWLIST, KYC_DOCUMENTS, type KycJurisdictionCode } from '@/lib/kyc/constants';
import { KYC_PRIMARY_BUTTON, KYC_SECONDARY_BUTTON } from '@/components/kyc/constants';

interface Props {
  jurisdiction: KycJurisdictionCode | null;
  files: Partial<Record<KycDocType, File>>;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

function jurisdictionName(code: KycJurisdictionCode | null): string {
  return KYC_ALLOWLIST.find((j) => j.code === code)?.name ?? '—';
}

// Body-only (the wizard owns the step heading). Summarises the payload, then submits. The busy state is
// indeterminate ("Uploading…") — a Server Action / fetch can't report byte progress (documented tradeoff).
export default function ReviewStep({ jurisdiction, files, submitting, onBack, onSubmit }: Props) {
  return (
    <div className="space-y-6">
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-charcoal/60">Jurisdiction</dt>
          <dd className="font-medium text-charcoal">{jurisdictionName(jurisdiction)}</dd>
        </div>
        {KYC_DOCUMENTS.map((d) => (
          <div key={d.docType} className="flex justify-between gap-4">
            <dt className="text-charcoal/60">{d.label}</dt>
            <dd className="max-w-[60%] truncate font-medium text-charcoal">
              {files[d.docType]?.name ?? '—'}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className={KYC_SECONDARY_BUTTON}
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </button>
        <button
          type="button"
          className={KYC_PRIMARY_BUTTON}
          onClick={onSubmit}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? 'Uploading…' : 'Submit for review'}
        </button>
      </div>
    </div>
  );
}
