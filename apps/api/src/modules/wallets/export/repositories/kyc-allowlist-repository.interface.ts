export const KYC_ALLOWLIST_REPOSITORY = 'IKycAllowlistRepository';

export interface IKycAllowlistRepository {
  /**
   * Whether a canonical target address is present among the LIVE (non-soft-deleted) allowlist rows.
   * Exact-match on the canonical StrKey (the partial unique index over `deleted_at IS NULL`).
   */
  existsActive(targetAddress: string): Promise<boolean>;
}
