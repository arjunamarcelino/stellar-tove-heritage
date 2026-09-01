/**
 * Offering async-deploy infrastructure constants (TOV-154, FR-05.02). Kept at the module root
 * (pattern M1) so both the neutral `offerings/` domain and the `offering-worker` module reference the
 * same queue names / lock key without a cross-import cycle.
 */

/** BullMQ queue that carries one escrow-deploy job per quorum-reaching approval. */
export const OFFERING_ESCROW_DEPLOY_QUEUE = 'offering-escrow-deploy';

/** BullMQ queue for the repeatable window-open + approval-expiry reconcile sweep (DB-only). */
export const OFFERING_RECONCILE_QUEUE = 'offering-reconcile';

/** BullMQ queue that carries one settlement job per admin `POST :id/settle` (TOV-160). */
export const OFFERING_SETTLE_QUEUE = 'offering-settle';

/** BullMQ queue for the repeatable stale-`subscribed` re-drive sweep (TOV-160, DB-only + best-effort enqueue). */
export const OFFERING_SETTLE_RECONCILE_QUEUE = 'offering-settle-reconcile';

/**
 * Redis lock key that serializes EVERY escrow deploy on the shared escrow admin/source account
 * (one keypair = one sequence). Distinct from the fraction/relayer/kyc-allowlist lock keys (D7).
 */
export const OFFERING_ESCROW_LOCK_KEY = 'relayer:offering-escrow:account';
