/**
 * Status of a single `kyc_submissions` row — the per-submission *review outcome*, a DISTINCT axis from the
 * user-level whitelist lifecycle (`KycStatus`, which lives in `@common/enums` because the neutral `users`
 * entity depends on it). This one is kyc-domain-private, so it lives with the module. A submission is never
 * `not_submitted` (that is a user-level state). Unchanged by TOV-29.
 */
export enum KycSubmissionStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
