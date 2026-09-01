/**
 * Canonical primary-Offering BID lifecycle states (TOV-156, FR-05.03). Single source of truth for BOTH the
 * runtime tuple (fed to `@ApiProperty({ enum })` and the response DTO) AND the derived `OfferingBidStatus`
 * type. Homed in a standalone constant — not the entity — so DTOs/validators import it without pulling the
 * TypeORM entity (mirrors `offering-status.constant.ts`, the "import down" rule).
 *
 * Lifecycle: `submitted → escrowed` (worker confirmed the on-chain `submit_bid`) or `submitted → failed`
 * (terminal on-chain/expiry error). The cancel/refund path (TOV-158, FR-05.04) adds `escrowed → canceling`
 * (the passkey-signed `cancel_bid` was recorded + enqueued) → `canceling → canceled` (refund confirmed,
 * slot freed) or `canceling → escrowed` (provably-no-refund failure / self-heal on signature expiry). The
 * settlement path (TOV-160, FR-05.05) adds the two SETTLE terminals `escrowed → won` (the bid cleared — it
 * received `allocated_count` fractions on-chain and its price-delta USDC refund) and `escrowed → lost` (it
 * did not clear — fully refunded on-chain); both are flipped in the SAME DB txn as the offering's
 * `subscribed → settled` CAS. The migration `…038` guard trigger enforces exactly this machine.
 *
 * The active set {submitted,escrowed,canceling} occupies the one-active-bid-per-collector slot
 * (`UQ_offering_bids_active_per_collector`); the slot-freeing terminals are {failed,canceled,won,lost}, so a
 * collector can re-bid once a bid fails, a cancel fully lands, or the offering settles. An integration test
 * drift-guards this tuple against the `CHK_bid_status` CHECK value set and this constant against the index
 * predicate.
 */
export const OFFERING_BID_STATUSES = [
  'submitted',
  'escrowed',
  'failed',
  'canceling',
  'canceled',
  'won',
  'lost',
] as const;

export type OfferingBidStatus = (typeof OFFERING_BID_STATUSES)[number];

/**
 * Active bid states — a collector may hold at most one at a time per offering
 * (`UQ_offering_bids_active_per_collector`). MUST equal that partial-unique index's `status IN (…)`
 * predicate; an integration test drift-guards the equality. `failed`/`canceled` are excluded so a re-bid is
 * allowed once a bid is terminal; `canceling` is included so the slot stays held while a refund is in flight.
 */
export const ACTIVE_BID_STATUSES = [
  'submitted',
  'escrowed',
  'canceling',
] as const satisfies readonly OfferingBidStatus[];
