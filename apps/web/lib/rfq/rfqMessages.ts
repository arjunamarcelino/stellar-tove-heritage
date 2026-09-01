import type { RfqErrorCode } from '@/lib/types/api';

// Curated, user-facing copy for every RFQ create outcome (TOV-173). Exactly-covering Record so an
// unmapped/renamed RfqErrorCode fails to compile here — a money-adjacent flow must never surface a raw backend
// message (which can echo internal diagnostics). The balance-warning numbers are interpolated in
// RfqConfirmation, not here (mirrors the offering panel). No fund-movement language ("you pay"/"escrow"): an
// RFQ is buy-intent only.
export const RFQ_MESSAGES: Record<RfqErrorCode, string> = {
  // ── Validation / eligibility ──
  VALIDATION_FAILED: 'Please check the offer details and try again.',
  RFQ_NOT_WHITELISTED: 'Complete KYC to make offers.',
  ARTWORK_NOT_FOUND: 'This artwork could not be found.',
  RFQ_ARTWORK_NOT_FRACTIONALIZED:
    'This artwork isn’t fractionalized yet, so it can’t receive offers.',
  RFQ_INVALID_PRICE: 'Enter a price above 0.',
  RFQ_AMOUNT_OVERFLOW: 'That price × quantity is too large. Lower the price or quantity.',
  RFQ_TOO_MANY_ACTIVE:
    'You’ve reached the maximum of 25 open offers. Cancel or let some expire, then try again.',
  // ── Idempotency (advisory — rendered in a polite live region, not an alert) ──
  IDEMPOTENCY_KEY_IN_FLIGHT:
    'Still processing — we’re confirming the offer you already sent, not creating a new one. Try again in a moment.',
  IDEMPOTENCY_KEY_MISMATCH: 'Something changed — please review and resubmit.',
  // ── Transport fallbacks ──
  SESSION_EXPIRED: 'Your session expired. Sign in again to make this offer.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};
