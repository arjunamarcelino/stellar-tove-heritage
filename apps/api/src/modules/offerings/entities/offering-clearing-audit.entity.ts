import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

/** One row of the sorted-walk clearing input, as recorded in `bids_snapshot` (money fields are strings). */
export interface ClearingBidSnapshotRow {
  chainBidId: number;
  collectorSub: string;
  priceStroops: string;
  count: string;
  createdAt: string;
}

/** One winner in `allocation_map` = the exact `(bid_id, allocated)` passed to `close_and_settle`. */
export interface ClearingAllocationRow {
  chainBidId: number;
  allocatedCount: string;
}

/**
 * The append-only settlement snapshot for a primary Offering (TOV-160, FR-05.05) — the regulatory money
 * artifact written IN THE SAME TXN as the offering's `subscribed → settled` CAS. `bids_snapshot` is the exact
 * sorted-walk input `(offering_id, price_stroops DESC, created_at ASC)`; `allocation_map` is the winners-only
 * `[(chain_bid_id, allocated)]` passed to the on-chain `close_and_settle`. Aggregate amounts are i128 sums
 * (2^127−1 domain), NOT per-unit stroops. A PLAIN `UNIQUE(offering_id)` is the one-settlement-per-offering
 * guard; a distinct-named append-only trigger enforces immutability. `settlement_tx_hash`/`settled_ledger`
 * are NULL on the self-heal ADOPT path (`adopted = true`) where the worker recovered a landed-but-unconfirmed
 * settlement.
 *
 * Under `synchronize:false` the migration `…038` is authoritative for the CHECKs + trigger; the entity
 * mirrors the shape for reads. Money `numeric(39,0)` → string; `settled_ledger` bigint → number.
 */
@Entity({ name: 'offering_clearing_audit' })
export class OfferingClearingAudit extends BaseEntity {
  @Column({ name: 'offering_id', type: 'uuid' })
  offeringId!: string;

  /** The uniform clearing price P every winner paid (per-fraction USDC stroops, ≤ 2^96−1). numeric → string. */
  @Column({ name: 'clearing_price_stroops', type: 'numeric', precision: 39, scale: 0 })
  clearingPriceStroops!: string;

  /** The float that cleared (`Σ allocated == public_float` exactly). numeric → string. */
  @Column({ name: 'public_float', type: 'numeric', precision: 39, scale: 0 })
  publicFloat!: string;

  /** Total fractions demanded (`Σ escrowed count`) at settle time. numeric → string. */
  @Column({ name: 'total_demand', type: 'numeric', precision: 39, scale: 0 })
  totalDemand!: string;

  /** `P · Σ allocated` — the primary proceeds (i128 sum, ≤ 2^127−1). numeric → string. */
  @Column({ name: 'proceeds_stroops', type: 'numeric', precision: 39, scale: 0 })
  proceedsStroops!: string;

  /** `floor(proceeds · 300 / 10000)` → treasury (3%). numeric → string. */
  @Column({ name: 'platform_fee_stroops', type: 'numeric', precision: 39, scale: 0 })
  platformFeeStroops!: string;

  /** `proceeds − platform_fee` → artist_payout (97%). numeric → string. */
  @Column({ name: 'artist_net_stroops', type: 'numeric', precision: 39, scale: 0 })
  artistNetStroops!: string;

  /**
   * Mint-conservation snapshot (TOV-165, FR-05.06) — makes the audit row self-contained so the on-chain mint
   * invariant is verifiable WITHOUT a `fraction_contracts`/`offerings` join. Enforced by three independent DB
   * CHECKs whose conjunction implies `Σ allocated + artist_retention + treasury_retention + absorbed_leftover
   * == total_supply`: `public_float = total_supply − artist_retention − treasury_retention` (decomposition),
   * `cleared_allocations = public_float`, `absorbed_leftover = 0`. All numeric(39,0) → string.
   */
  /** `Σ` of the winners' allocated counts — computed INDEPENDENTLY (not echoed from `public_float`) so the
   *  `cleared_allocations == public_float` CHECK is a genuine cross-check against a corrupted allocation. */
  @Column({ name: 'cleared_allocations_stroops', type: 'numeric', precision: 39, scale: 0 })
  clearedAllocationsStroops!: string;

  /** The `leftover_to_artist` mint bucket (FR-04.06) — pinned to `0` by CHECK until a non-zero leftover ships. */
  @Column({ name: 'absorbed_leftover_stroops', type: 'numeric', precision: 39, scale: 0 })
  absorbedLeftoverStroops!: string;

  /** Total fraction supply, frozen at planning (= the offering's snapshot). numeric → string. */
  @Column({ name: 'total_supply_stroops', type: 'numeric', precision: 39, scale: 0 })
  totalSupplyStroops!: string;

  /** Artist retention amount, frozen at planning. numeric → string. */
  @Column({ name: 'artist_retention_stroops', type: 'numeric', precision: 39, scale: 0 })
  artistRetentionStroops!: string;

  /** Treasury retention amount, frozen at planning. numeric → string. */
  @Column({ name: 'treasury_retention_stroops', type: 'numeric', precision: 39, scale: 0 })
  treasuryRetentionStroops!: string;

  /** The exact sorted-walk input (AC-2: `bids_snapshot` equals the sorted-walk input). */
  @Column({ name: 'bids_snapshot', type: 'jsonb' })
  bidsSnapshot!: ClearingBidSnapshotRow[];

  /** Winners-only `[(chain_bid_id, allocated)]` passed to `close_and_settle`. */
  @Column({ name: 'allocation_map', type: 'jsonb' })
  allocationMap!: ClearingAllocationRow[];

  /** Lowercase hex tx hash of the on-chain `close_and_settle`; NULL on a self-heal adopt. */
  @Column({ name: 'settlement_tx_hash', type: 'char', length: 64, nullable: true })
  settlementTxHash!: string | null;

  /** The ledger the settlement landed in; NULL on a self-heal adopt. bigint → number. */
  @Column({
    name: 'settled_ledger',
    type: 'bigint',
    nullable: true,
    transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? null : Number(v)) },
  })
  settledLedger!: number | null;

  /** True when this snapshot was written via the self-heal ADOPT path (landed-but-unconfirmed recovery). */
  @Column({ name: 'adopted', type: 'boolean', default: false })
  adopted!: boolean;

  /** When the clearing was recorded (== the settle-CAS commit). */
  @Column({ name: 'cleared_at', type: 'timestamptz' })
  clearedAt!: Date;
}
