import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import type {
  EscrowDeployStatus,
  OfferingStatus,
} from '../constants/offering-status.constant';

/**
 * One row per planned primary Offering for a fractionalized artwork (TOV-152, FR-05.01). Created in the
 * `planned` state; later M05 FRs move it through `approved → opened → subscribed → settled` (+ terminal
 * `canceled`). The partial-unique index `UQ_offerings_active_per_artwork` (migration) enforces at most one
 * active (`planned|approved|opened|subscribed`) offering per artwork. Numeric i128 money amounts are stored
 * as `numeric(39,0)` (bigint-safe strings in TypeORM).
 *
 * Under `synchronize:false` a `@Index` decorator is inert — the migration is authoritative — so no separate
 * `artwork_id` index is declared here; the `UQ_offerings_active_per_artwork` partial index covers this FR's read.
 */
@Entity({ name: 'offerings' })
export class Offering extends BaseEntity {
  @Column({ name: 'artwork_id', type: 'uuid' })
  artworkId!: string;

  /** FK — provenance of the public-float snapshot (the exact `fraction_contracts` row it was computed from). */
  @Column({ name: 'fraction_contract_id', type: 'uuid' })
  fractionContractId!: string;

  @Column({ type: 'varchar', length: 16, default: 'planned' })
  status!: OfferingStatus;

  /** Price band lower bound (i128, decimals=0 stroops). numeric → string in TypeORM. */
  @Column({ name: 'low_price_stroops', type: 'numeric', precision: 39, scale: 0 })
  lowPriceStroops!: string;

  @Column({ name: 'high_price_stroops', type: 'numeric', precision: 39, scale: 0 })
  highPriceStroops!: string;

  /** Floatable supply snapshot computed once at planning (i128). numeric → string in TypeORM. */
  @Column({ name: 'public_float', type: 'numeric', precision: 39, scale: 0 })
  publicFloat!: string;

  /**
   * Supply/retention snapshot frozen at planning from the deployed `fraction_contracts` row (TOV-165,
   * FR-05.06) — the raw inputs of `public_float = total_supply − artist_retention − treasury_retention`
   * (`CHK_off_public_float_decomposition`). Mirrors the `public_float` / `snapshot_artist_address` freeze so
   * settlement never re-reads `fraction_contracts` (which is mutable): the settle worker copies these into the
   * self-contained `offering_clearing_audit` mint-conservation snapshot. numeric(39,0) → string.
   */
  @Column({ name: 'total_supply_stroops', type: 'numeric', precision: 39, scale: 0 })
  totalSupplyStroops!: string;

  @Column({ name: 'artist_retention_stroops', type: 'numeric', precision: 39, scale: 0 })
  artistRetentionStroops!: string;

  @Column({ name: 'treasury_retention_stroops', type: 'numeric', precision: 39, scale: 0 })
  treasuryRetentionStroops!: string;

  @Column({ name: 'window_open_at', type: 'timestamptz' })
  windowOpenAt!: Date;

  @Column({ name: 'window_close_at', type: 'timestamptz' })
  windowCloseAt!: Date;

  /**
   * The verified admin JWT `sub` who planned this offering. Deliberate denormalization (todo 260): the
   * `offering.planned` audit row also records the actor, but an offering is a long-lived money object and
   * an on-row creator supports a future admin "offerings by planner" read without joining the append-only
   * (separately-retained/prunable) audit log. Audit-actor semantics → intentionally no FK to `admins`
   * (retain the historical actor even if the admin is later removed).
   */
  @Column({ name: 'created_by_admin_sub', type: 'uuid' })
  createdByAdminSub!: string;

  /**
   * Escrow deploy latch (TOV-154, source of truth): `NULL` (never deployed) → `deploying` (quorum
   * met, worker claimed) → `deployed` (on-chain success, `status` also flipped to `approved` in the
   * same CAS txn) or `failed` (retryable). Nullable because pre-TOV-154 planned rows have no escrow.
   */
  @Column({ name: 'escrow_deploy_status', type: 'varchar', length: 16, nullable: true })
  escrowDeployStatus!: EscrowDeployStatus | null;

  /** The deployed per-offering `OfferingEscrow` Soroban contract address (`C…`), set on `deployed`. */
  @Column({ name: 'escrow_contract_address', type: 'char', length: 56, nullable: true })
  escrowContractAddress!: string | null;

  /**
   * Money-routing attestation snapshot (TOV-154 / security BLOCKER-1): the artist/payout address the
   * approvers attest to, frozen at first approval; the deploy worker asserts `fraction_contracts`
   * still matches before deploying so a mid-quorum mutation can't re-route funds.
   */
  @Column({ name: 'snapshot_artist_address', type: 'char', length: 56, nullable: true })
  snapshotArtistAddress!: string | null;

  /**
   * Terminal settlement-failure signal (TOV-160): when the settle worker gives up on a deterministic
   * failure (e.g. contract `InvalidAllocation`, resource exhaustion) it stamps these and leaves the offering
   * in `subscribed` (never partially settled). Distinguishes "settlement wedged/failed" from "settlement in
   * progress" at `GET :id` (both otherwise sit in `subscribed`). Cleared (→ NULL) on a re-drive → NOT
   * write-once. Both present or both NULL (`CHK_off_settle_fail_clean`).
   */
  @Column({ name: 'settle_failed_at', type: 'timestamptz', nullable: true })
  settleFailedAt!: Date | null;

  /** Machine-readable settle-failure code (≤200 chars, sanitized); NULL unless `settle_failed_at` is set. */
  @Column({ name: 'settle_failure_reason', type: 'varchar', length: 200, nullable: true })
  settleFailureReason!: string | null;
}
