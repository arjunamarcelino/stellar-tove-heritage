/**
 * Collector **whitelist lifecycle**, stored on `users.kyc_status` (TOV-28 / TOV-29, FR-01.07 / FR-01.08).
 * `not_submitted` is the default; a submission moves it to `pending_review`; the M12 multi-sig decision
 * flow (Phase 2) later drives `whitelisted` / `frozen` / `removed`.
 *
 * NOTE: the column + enum keep the historical `kyc_status` / `KycStatus` name but now hold a *whitelist*
 * vocabulary (so `kycStatus === WHITELISTED` is expected) — no rename, to avoid churn. A user-level
 * `rejected` is deliberately NOT a state: a rejected collector folds back to `not_submitted` and may
 * resubmit; the per-submission rejection outcome lives on `KycSubmissionStatus`
 * (`@modules/kyc/enums/kyc-submission-status.enum`), a distinct kyc-domain-private axis.
 *
 * Lives in `common/enums` (not the `kyc` feature module) so the neutral `users` entity — which owns the
 * `kyc_status` column — imports its type *down*, not up into a leaf module (TOV-29 R1). The migration
 * owns the matching `CHK_users_kyc_status` CHECK; keep the two in lock-step (see the enum-parity test).
 */
export enum KycStatus {
  NOT_SUBMITTED = 'not_submitted',
  PENDING_REVIEW = 'pending_review',
  WHITELISTED = 'whitelisted',
  FROZEN = 'frozen',
  REMOVED = 'removed',
}
