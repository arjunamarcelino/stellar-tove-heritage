/**
 * Shared literals + result types for the on-chain KYC allowlist (TOV-235). The `as const` tuples are the
 * single source of truth for the DTO enum, the DB CHECK constraints, and these types — so they can't drift.
 */

export const KYC_ALLOWLIST_ACTIONS = ['add', 'remove'] as const;
export type KycAllowlistAction = (typeof KYC_ALLOWLIST_ACTIONS)[number];

export const KYC_ALLOWLIST_RESULTS = ['confirmed', 'pending', 'failed', 'noop', 'deferred'] as const;
export type KycAllowlistResultStatus = (typeof KYC_ALLOWLIST_RESULTS)[number];

/** One requested allowlist mutation, post-validation. */
export interface KycAllowlistItem {
  wallet: string;
  action: KycAllowlistAction;
  reason?: string | null;
}

/**
 * Internal per-item outcome — a discriminated union so illegal states are unrepresentable (a `noop` can't
 * carry a `txHash`; a `confirmed` always does). Flattened to the wire DTO at the HTTP boundary.
 */
export type KycAllowlistItemResult =
  | { status: 'confirmed'; wallet: string; action: KycAllowlistAction; isAllowed: boolean; txHash: string; ledger: number }
  | { status: 'pending'; wallet: string; action: KycAllowlistAction; txHash: string }
  | { status: 'failed'; wallet: string; action: KycAllowlistAction; errorReason: string }
  | { status: 'noop'; wallet: string; action: KycAllowlistAction; isAllowed: boolean }
  | { status: 'deferred'; wallet: string; action: KycAllowlistAction };

/** Insertable append-only event row (no id / created_at — the DB assigns them). */
export interface NewKycAllowlistEvent {
  batchId: string;
  wallet: string;
  action: KycAllowlistAction;
  adminId: string;
  txHash?: string | null;
  reason?: string | null;
  result: KycAllowlistResultStatus;
  errorReason?: string | null;
}
