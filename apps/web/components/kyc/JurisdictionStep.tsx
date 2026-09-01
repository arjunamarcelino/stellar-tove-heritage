'use client';

import { useId } from 'react';
import { KYC_ALLOWLIST, type KycJurisdictionCode } from '@/lib/kyc/constants';
import { jurisdictionSchema } from '@/lib/kyc/schemas';
import { KYC_ERROR_CLASS } from '@/components/kyc/constants';

interface Props {
  value: KycJurisdictionCode | null;
  error?: string;
  onSelect: (code: KycJurisdictionCode) => void;
}

// A native <select> — fully keyboard-operable and screen-reader-labelled with zero custom ARIA. Options
// are ONLY the active allowlist (FR-01.07); the backend's 422 JURISDICTION_NOT_ELIGIBLE is the backstop.
export default function JurisdictionStep({ value, error, onSelect }: Props) {
  const selectId = useId();
  const errorId = useId();

  return (
    <div className="space-y-3">
      <label htmlFor={selectId} className="block text-sm font-medium text-charcoal">
        Country of residence
      </label>
      <select
        id={selectId}
        value={value ?? ''}
        onChange={(e) => {
          // Narrow through the shared schema instead of an `as` cast (consistent with the
          // FormData-through-Zod discipline everywhere else; rejects the empty sentinel too).
          const parsed = jurisdictionSchema.safeParse(e.target.value);
          if (parsed.success) onSelect(parsed.data);
        }}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className="w-full rounded-sm border border-charcoal/20 bg-white px-4 py-3 text-charcoal focus:border-ochre focus:outline-none"
      >
        <option value="" disabled>
          Select your country…
        </option>
        {KYC_ALLOWLIST.map((j) => (
          <option key={j.code} value={j.code}>
            {j.name}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} role="alert" className={KYC_ERROR_CLASS}>
          {error}
        </p>
      )}
    </div>
  );
}
