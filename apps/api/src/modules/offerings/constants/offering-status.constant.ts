/**
 * Canonical primary-Offering lifecycle states (TOV-152, FR-05.01). Single source of truth for BOTH the
 * runtime tuple (fed to class-validator / `@ApiProperty({ enum })`) AND the derived `OfferingStatus` type.
 * Homed in a standalone constant — not the entity — so DTOs/validators can import it without pulling the
 * TypeORM entity (mirrors `artwork-status.constant.ts` and the `@common/enums/kyc-status.enum` "import
 * down" precedent, avoiding an import cycle).
 *
 * Lifecycle: `planned → approved → opened → subscribed → settled` (+ terminal `canceled`). This endpoint
 * only writes `planned`.
 *
 * The non-terminal (active) set {planned,approved,opened,subscribed} is enforced by the migration's
 * UQ index WHERE-clause (raw SQL — can't reference TS) AND mirrored by `ACTIVE_OFFERING_STATUSES`
 * below, which `OfferingRepository.findActiveByArtworkId` (TOV-153) consumes. A WS8 integration test
 * drift-guards the TS constant against that index predicate (`pg_indexes`/`pg_get_indexdef`) so the two
 * can't diverge when a future M05 FR adds a non-terminal status.
 */
export const OFFERING_STATUSES = [
  'planned',
  'approved',
  'opened',
  'subscribed',
  'settled',
  'canceled',
] as const;

export type OfferingStatus = (typeof OFFERING_STATUSES)[number];

/**
 * Non-terminal ("active"/pending) offering states — an artwork may have at most one at a time
 * (`UQ_offerings_active_per_artwork`). MUST equal that partial-unique index's `status IN (…)` predicate;
 * a WS8 integration test drift-guards the equality. Terminal states (`settled`, `canceled`) are excluded.
 */
export const ACTIVE_OFFERING_STATUSES = ['planned', 'approved', 'opened', 'subscribed'] as const;

/**
 * Escrow deploy sub-state (TOV-154). The source-of-truth latch for the async per-offering escrow
 * deploy, advanced together with `offerings.status` in one CAS txn (`NULL → deploying → deployed`,
 * or `deploying → failed` on a retryable failure). Kept as a standalone named union (not `?:`) so the
 * entity column, DTOs, and the migration `CHK_off_escrow_deploy_status` CHECK all reference one source
 * of truth; a WS8/WS11 integration test drift-guards the union against the CHECK predicate.
 *
 * Derived from the runtime tuple (todo 290) so the Swagger `@ApiProperty({ enum })` reuses ONE list
 * instead of a hand-copied array — mirrors `OFFERING_STATUSES` / `OfferingStatus`.
 */
export const ESCROW_DEPLOY_STATUSES = ['deploying', 'deployed', 'failed'] as const;
export type EscrowDeployStatus = (typeof ESCROW_DEPLOY_STATUSES)[number];
