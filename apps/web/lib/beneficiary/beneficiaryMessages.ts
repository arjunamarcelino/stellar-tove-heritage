// Curated, product-safe copy for the beneficiary-designation surface (TOV-46 / FR-01.10). Client-safe (no
// 'server-only'); mirrors lib/profile/profileSettingsMessages.ts. A raw backend `message` is NEVER surfaced
// — the service maps every error to a code and the UI shows only these strings. Keyed on the error-code
// union (`Record<Union, string>`) so adding a code fails to compile until copy exists.

import type { BeneficiaryErrorCode } from '@/lib/types/api';

export const BENEFICIARY_MESSAGES: Record<BeneficiaryErrorCode, string> = {
  VALIDATION_FAILED: 'Please check the highlighted fields and try again.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};

// The informational KYC banner copy — keyed by the stable notice code (never the backend message text).
// Final copy is subject to product/legal sign-off; the code is the contract.
export const BENEFICIARY_NOTICE_MESSAGES = {
  KYC_REQUIRED_FOR_TRANSFER:
    'Complete KYC verification to enable inheritance transfers to this beneficiary. Your designation is saved either way.',
} as const;
