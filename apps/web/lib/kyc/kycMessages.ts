import type { KycSubmitErrorCode } from '@/lib/types/api';

// Single source of truth for KYC error copy (TOV-34 / FR-01.07), shared by the server service (mapError
// fallbacks) and the client hook so the two can't fork (mirrors manageMessages.ts). Client-safe (no
// 'server-only'). Exhaustive over KycSubmitErrorCode — adding a code fails to compile until copy is
// supplied. A KYC pipeline never surfaces a raw backend message (it can echo internal diagnostics), so
// these curated strings are the ONLY error text the UI shows.
export const KYC_SUBMIT_MESSAGES: Record<KycSubmitErrorCode, string> = {
  JURISDICTION_NOT_ELIGIBLE: 'That country isn’t eligible for verification yet.',
  KYC_ALREADY_PENDING: 'You already have a submission under review.',
  KYC_ALREADY_APPROVED: 'Your identity is already verified.',
  KYC_MISSING_DOCUMENT: 'A required document is missing. Please add all four and try again.',
  KYC_UNEXPECTED_DOCUMENT: 'Something went wrong with your upload. Please try again.',
  KYC_UNSUPPORTED_MEDIA_TYPE: 'One of your files isn’t a supported type. Use JPEG, PNG or PDF.',
  KYC_FILE_TOO_LARGE: 'One of your files is larger than the 10 MB limit.',
  KYC_FILE_EMPTY: 'One of your files appears to be empty. Please re-upload it.',
  IDEMPOTENCY_KEY_IN_FLIGHT: 'Still finishing your previous submission — one moment…',
  IDEMPOTENCY_KEY_MISMATCH: 'Something changed mid-submission. Please review and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a while and try again.',
  VALIDATION_FAILED: 'Please check your details and try again.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  NETWORK_ERROR: 'We couldn’t reach Tove. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};
