import type { RfqErrorCode, RfqGateReason } from '@/lib/types/api';

// How the panel recovers from each RFQ error code (TOV-176 backport of the quote feature's table-driven
// routing — see components/quote/affordance.ts). An EXHAUSTIVE Record keyed on the union, so a new
// RfqErrorCode fails to compile until it's routed here — the same compile-time lever as RFQ_MESSAGES. This
// preserves RfqPanel's original behaviour exactly; it replaces the hand-maintained inline `state.code === …`
// conditional ladder with a single classifier.
export type ErrorAffordance =
  | { kind: 'retry' } // transient/generic — role="alert" + "Try again" (retry())
  | { kind: 'in-flight' } // 409 IN_FLIGHT — polite role="status" advisory + "Try again"
  | { kind: 'gate'; reason: RfqGateReason } // complete-KYC backstop — no re-failing retry
  | { kind: 'sign-in' } // session expired — re-auth
  | { kind: 'dead-end' }; // deterministic eligibility — informative alert, NO retry

export const RFQ_AFFORDANCE: Record<RfqErrorCode, ErrorAffordance> = {
  SESSION_EXPIRED: { kind: 'sign-in' },
  RFQ_NOT_WHITELISTED: { kind: 'gate', reason: 'not-whitelisted' },
  IDEMPOTENCY_KEY_IN_FLIGHT: { kind: 'in-flight' },
  // Deterministic — a same-body retry re-fails, so no "Try again" (matches the original inline routing).
  ARTWORK_NOT_FOUND: { kind: 'dead-end' },
  RFQ_ARTWORK_NOT_FRACTIONALIZED: { kind: 'dead-end' },
  // Transient / generic — a same-key retry can succeed (the original generic "Try again" arm).
  VALIDATION_FAILED: { kind: 'retry' },
  RFQ_INVALID_PRICE: { kind: 'retry' },
  RFQ_AMOUNT_OVERFLOW: { kind: 'retry' },
  RFQ_TOO_MANY_ACTIVE: { kind: 'retry' },
  IDEMPOTENCY_KEY_MISMATCH: { kind: 'retry' },
  RATE_LIMITED: { kind: 'retry' },
  NETWORK_ERROR: { kind: 'retry' },
  SERVER_ERROR: { kind: 'retry' },
};
