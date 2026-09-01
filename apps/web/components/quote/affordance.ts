import type { QuoteErrorCode, QuoteGateReason } from '@/lib/types/api';

// How the panel recovers from each error code (TOV-176 / FR-06.03, R1.4). An EXHAUSTIVE Record keyed on the
// union — a new QuoteErrorCode (e.g. a future QUOTE_PRICE_EXCEEDS_ASK) fails to compile until it's routed here,
// the same compile-time lever as QUOTE_MESSAGES. Encodes the error-routing decisions from the plan (C2/C3/C6/C9).
// Key-reuse policy (same key vs fresh on MISMATCH) is NOT encoded here — the hook (`useSubmitQuote.retry`)
// derives it from the error code, the single source of truth. This table only classifies the RENDER shape.
export type ErrorAffordance =
  | { kind: 'retry' } // transient — retry() (the hook owns same-vs-fresh key)
  | { kind: 'gate'; reason: QuoteGateReason } // eligibility CTA (complete KYC) — no re-failing retry
  | { kind: 'wallet-setup' } // set up a settlement wallet — no retry
  | { kind: 'sign-in' } // session expired — re-auth
  | { kind: 'inline-balance' } // INSUFFICIENT — form stays live, recover via a fresh submit(), NO retry button
  | { kind: 'dead-end' }; // deterministic — informative alert + escape nav link, NO retry

export const QUOTE_AFFORDANCE: Record<QuoteErrorCode, ErrorAffordance> = {
  // Insufficient balance — the form stays mounted; recovery is the form's own submit() (fresh key, C2).
  QUOTE_INSUFFICIENT_FREE_BALANCE: { kind: 'inline-balance' },
  // Eligibility / auth — a tailored next step, never a re-failing "Try again".
  QUOTE_NOT_WHITELISTED: { kind: 'gate', reason: 'not-whitelisted' },
  QUOTE_NO_SETTLEMENT_WALLET: { kind: 'wallet-setup' },
  SESSION_EXPIRED: { kind: 'sign-in' },
  // Deterministic dead-ends — a same-body retry re-fails, so an informative alert + an escape link (C3/C6).
  QUOTE_ALREADY_OPEN: { kind: 'dead-end' },
  QUOTE_RFQ_NOT_FOUND: { kind: 'dead-end' },
  QUOTE_RFQ_NOT_OPEN: { kind: 'dead-end' },
  QUOTE_RFQ_EXPIRED: { kind: 'dead-end' },
  QUOTE_ON_OWN_RFQ: { kind: 'dead-end' },
  QUOTE_INVALID_PRICE: { kind: 'dead-end' },
  QUOTE_AMOUNT_OVERFLOW: { kind: 'dead-end' },
  QUOTE_INVALID_VALIDITY: { kind: 'dead-end' },
  VALIDATION_FAILED: { kind: 'dead-end' },
  // Transient — a same-key retry can succeed (IN_FLIGHT is rendered as a polite advisory by the panel).
  IDEMPOTENCY_KEY_IN_FLIGHT: { kind: 'retry' },
  IDEMPOTENCY_KEY_MISMATCH: { kind: 'retry' },
  QUOTE_BALANCE_UNAVAILABLE: { kind: 'retry' },
  RATE_LIMITED: { kind: 'retry' },
  NETWORK_ERROR: { kind: 'retry' },
  SERVER_ERROR: { kind: 'retry' },
};
