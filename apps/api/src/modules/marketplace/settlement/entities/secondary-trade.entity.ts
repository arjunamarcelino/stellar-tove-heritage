import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import type { SecondaryTradeStatus } from '../constants/secondary-trade-status.constant';

/**
 * One row per settled (or attempted) secondary trade (TOV-177, FR-06.04+06.05). Created `pending` when the
 * buyer submits an accept — the `pending` row itself is the double-accept latch (partial-unique per RFQ) and
 * the tamper-evident initiation record. The async settle worker CAS-flips it `settled` (chain-confirmed) or
 * `failed`. Money amounts are `numeric(39,0)` → bigint-safe strings; `gross_stroops` is a STORED generated
 * column (read-only here — never written by the app).
 *
 * Under `synchronize:false` the migration (`1716000000045`) is authoritative for the CHECK belts, the two
 * composite FKs (token anti-drift `(rfq_id, fraction_contract_id)` + pairing anti-drift `(quote_id, rfq_id)`),
 * the `UQ_secondary_trades_pending` latch, the full-unique `UQ_secondary_trades_idem`, and the guard trigger
 * (`fn_secondary_trades_guard`: block delete/soft-delete, freeze money/identity cols, write-once
 * `tx_hash`/`settled_at`, forward-only `pending → settled|failed`). This entity mirrors the shape.
 */
@Entity({ name: 'secondary_trades' })
export class SecondaryTrade extends BaseEntity {
  /** The RFQ this trade settles. Part of both composite FKs. */
  @Column({ name: 'rfq_id', type: 'uuid' })
  rfqId!: string;

  /** The winning quote. Part of the `(quote_id, rfq_id)` composite FK (pins the quote to its RFQ). */
  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId!: string;

  /** The buyer's verified JWT `sub` (= the RFQ creator). Audit-actor semantics → no FK to `users`. */
  @Column({ name: 'buyer_sub', type: 'uuid' })
  buyerSub!: string;

  /** The seller's verified JWT `sub` (= the quote holder). Audit-actor semantics → no FK to `users`. */
  @Column({ name: 'seller_sub', type: 'uuid' })
  sellerSub!: string;

  @Column({ name: 'fraction_contract_id', type: 'uuid' })
  fractionContractId!: string;

  /** Fractions traded (= the quote's count, i128, decimals=0). numeric → string. */
  @Column({ name: 'fraction_count', type: 'numeric', precision: 39, scale: 0 })
  fractionCount!: string;

  /** The quote's ask per fraction (USDC stroops, i128). numeric → string. */
  @Column({ name: 'price_per_fraction_stroops', type: 'numeric', precision: 39, scale: 0 })
  pricePerFractionStroops!: string;

  /**
   * `fraction_count × price_per_fraction_stroops` = what the buyer pays (the seller nets it minus the
   * on-chain 1.5%+1.5% fees). STORED generated, unbounded `numeric` (a `numeric(39,0)` product would overflow),
   * i128-bounded by `CHK_trade_gross_max`. Read-only: never in INSERT/UPDATE — the DB computes it.
   */
  @Column({
    name: 'gross_stroops',
    type: 'numeric',
    generatedType: 'STORED',
    asExpression: '"fraction_count" * "price_per_fraction_stroops"',
    insert: false,
    update: false,
    select: true,
  })
  grossStroops!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'pending' })
  status!: SecondaryTradeStatus;

  /** Machine-readable reason a trade `failed` (e.g. `seller_balance_insufficient`). NULL while pending/settled. */
  @Column({ name: 'failure_reason', type: 'varchar', length: 48, nullable: true })
  failureReason!: string | null;

  /**
   * Stellar tx hash of the confirmed `accept_quote`. Write-once (NULL→value). Set when THIS worker submitted the
   * winning tx; NULL on a `settled` trade that was ADOPTED (the tx landed via another attempt / was self-healed
   * or reconciled by `is_settled`, so the DB caught up without holding the hash). The write-once guard permits a
   * later NULL→value backfill (#391 / a future reconcile), so the column is not proof of "not settled".
   */
  @Column({ name: 'tx_hash', type: 'varchar', length: 64, nullable: true })
  txHash!: string | null;

  /** When the trade confirmed on-chain. Write-once (NULL→value). Present only when `settled`. */
  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  /**
   * Durable idempotency dedup belt = sha256(`buyerSub|rfqId|Idempotency-Key`). Persisted with the full-unique
   * `UQ_secondary_trades_idem (buyer_sub, rfq_id, idempotency_key_hash)`, so a crash between the DB commit and
   * the Redis `complete()` cannot double-create — a same-key retry hits the constraint and replays the row.
   */
  @Column({ name: 'idempotency_key_hash', type: 'bytea' })
  idempotencyKeyHash!: Buffer;
}
