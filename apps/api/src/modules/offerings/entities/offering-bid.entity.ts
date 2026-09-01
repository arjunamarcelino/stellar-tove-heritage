import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import type { OfferingBidStatus } from '../constants/offering-bid-status.constant';

/**
 * One row per bid a whitelisted Collector places on an `opened` primary Offering (TOV-156, FR-05.03).
 * Created `submitted`; the async escrow worker moves it to `escrowed` (on-chain `submit_bid` confirmed,
 * stamping `chain_bid_id` + `escrow_tx_hash`) or `failed` (terminal). The partial-unique index
 * `UQ_offering_bids_active_per_collector` (migration 1716000000036) enforces at most one active
 * (`submitted|escrowed`) bid per (offering, collector). Money amounts are `numeric(39,0)` → bigint-safe
 * strings in TypeORM; `escrow_amount_stroops` is a DB STORED generated column (app never writes it).
 *
 * Under `synchronize:false` the migration is authoritative for the generated column + CHECKs + the
 * append-only-ish guard trigger; the entity mirrors the shape for reads.
 */
@Entity({ name: 'offering_bids' })
export class OfferingBid extends BaseEntity {
  @Column({ name: 'offering_id', type: 'uuid' })
  offeringId!: string;

  /** The bidding Collector's verified JWT `sub`. Audit-actor semantics → intentionally no FK to `users`. */
  @Column({ name: 'collector_sub', type: 'uuid' })
  collectorSub!: string;

  /** The bidder's embedded smart-wallet contract (`C…`), server-resolved at submit (the transfer `from`). */
  @Column({ name: 'collector_wallet', type: 'char', length: 56 })
  collectorWallet!: string;

  /** Bid price per fraction (USDC stroops, i128). numeric → string. `low ≤ price ≤ high` (backend-checked). */
  @Column({ name: 'price_stroops', type: 'numeric', precision: 39, scale: 0 })
  priceStroops!: string;

  /** Number of fractions bid for (i128, matches on-chain `count` + `public_float`). numeric → string. */
  @Column({ name: 'count', type: 'numeric', precision: 39, scale: 0 })
  count!: string;

  /**
   * Escrowed amount = `price_stroops × count`. DB STORED generated column (single source of truth — the app
   * never writes it), read-only here via `insert:false`/`update:false`. numeric → string.
   */
  @Column({
    name: 'escrow_amount_stroops',
    type: 'numeric',
    insert: false,
    update: false,
  })
  escrowAmountStroops!: string;

  @Column({ type: 'varchar', length: 16, default: 'submitted' })
  status!: OfferingBidStatus;

  /**
   * The 1-based bid id returned by the escrow contract's `submit_bid`; NULL until `escrowed`. Stored as
   * `bigint` to hold the contract's full u32 domain (up to 2^32−1 > int4 max); a u32 is < 2^53 so the
   * `Number` transformer is lossless.
   */
  @Column({
    name: 'chain_bid_id',
    type: 'bigint',
    nullable: true,
    transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? null : Number(v)) },
  })
  chainBidId!: number | null;

  /** Lowercase hex tx hash of the on-chain `submit_bid`; NULL until `escrowed`. */
  @Column({ name: 'escrow_tx_hash', type: 'char', length: 64, nullable: true })
  escrowTxHash!: string | null;

  /**
   * Lowercase hex tx hash of the on-chain `cancel_bid` refund (TOV-158); NULL until `canceled`. Write-once
   * (migration `…037` guard trigger), and structurally present iff `status='canceled'` (`CHK_bid_refund_clean`
   * / `CHK_bid_canceled_stamped`).
   */
  @Column({ name: 'refund_tx_hash', type: 'char', length: 64, nullable: true })
  refundTxHash!: string | null;

  /** When the refund confirmed (`canceling → canceled`); NULL until `canceled`. Write-once (TOV-158). */
  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt!: Date | null;

  /**
   * Fractions this bid was allocated at settlement (TOV-160); NULL until `won`/`lost`. `> 0` for `won`, `0`
   * for `lost` (structurally present iff settled — `CHK_bid_settled_stamped`/`CHK_bid_unsettled_clean`).
   * Write-once (migration `…038` guard trigger). Self-describes the receipt without a jsonb-audit join.
   */
  @Column({ name: 'allocated_count', type: 'numeric', precision: 39, scale: 0, nullable: true })
  allocatedCount!: string | null;

  /**
   * USDC (stroops) refunded to this bid at settlement (TOV-160); NULL until `won`/`lost`. For a winner this
   * is the price-delta refund `escrow − P·allocated`; for a loser it is the full `escrow_amount_stroops`.
   * Write-once. numeric → string.
   */
  @Column({ name: 'settle_refund_stroops', type: 'numeric', precision: 39, scale: 0, nullable: true })
  settleRefundStroops!: string | null;

  /**
   * The on-chain `idempotency_key` (BytesN<32>) baked into the signed `submit_bid` tx =
   * sha256(offeringId | collectorSub | HTTP Idempotency-Key). Persisted for the DB-level dedupe belt
   * (`UQ_offering_bids_idem`), mirroring the contract's own `DuplicateBid` guard.
   */
  @Column({ name: 'idempotency_hash', type: 'bytea' })
  idempotencyHash!: Buffer;
}
