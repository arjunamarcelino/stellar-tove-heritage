import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import type { RfqStatus } from '../constants/rfq-status.constant';

/**
 * One row per Request-for-Quote a whitelisted Collector issues on a fractionalized artwork (TOV-172,
 * FR-06.01). Created `open`; the later marketplace FRs transition it (`filled`/`canceled`/`expired`).
 * Pure DB record — no on-chain leg. Money amounts are `numeric(39,0)` → bigint-safe strings in TypeORM.
 *
 * Under `synchronize:false` the migration (`1716000000041`) is authoritative for the CHECK belts, the
 * composite FK `(artwork_id, fraction_contract_id) → fraction_contracts(artwork_id, id)`, the full-unique
 * dedup index `UQ_rfqs_idem`, and the immutability guard trigger (`fn_rfqs_guard` freezes the money-intent
 * columns + blocks delete/soft-delete + allows status transitions). This entity mirrors the shape for reads.
 */
@Entity({ name: 'rfqs' })
export class Rfq extends BaseEntity {
  /** The issuing Collector's verified JWT `sub`. Audit-actor semantics → intentionally no FK to `users`. */
  @Column({ name: 'collector_sub', type: 'uuid' })
  collectorSub!: string;

  @Column({ name: 'artwork_id', type: 'uuid' })
  artworkId!: string;

  /** The deployed fraction contract snapshotted at creation (part of the composite FK to artwork). */
  @Column({ name: 'fraction_contract_id', type: 'uuid' })
  fractionContractId!: string;

  /** Number of fractions the collector wants to buy (i128, decimals=0). numeric → string. */
  @Column({ name: 'fraction_count', type: 'numeric', precision: 39, scale: 0 })
  fractionCount!: string;

  /** Max price per fraction the collector will pay (USDC stroops, i128). numeric → string. */
  @Column({ name: 'max_price_per_fraction_stroops', type: 'numeric', precision: 39, scale: 0 })
  maxPricePerFractionStroops!: string;

  /** `created_at + (expiry_hours ?? 48)h`. Readers derive "expired" from this; no background sweeper yet. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'open' })
  status!: RfqStatus;

  /**
   * Durable idempotency dedup belt = sha256(`userId|Idempotency-Key`). Persisted with the full-unique index
   * `UQ_rfqs_idem (collector_sub, idempotency_key_hash)`, so a crash between the DB commit and the Redis
   * `complete()` cannot double-create — a same-key retry hits the constraint and replays the existing row.
   */
  @Column({ name: 'idempotency_key_hash', type: 'bytea' })
  idempotencyKeyHash!: Buffer;

  /**
   * Notification fan-out completion latch (TOV-174, FR-06.02). NULL until the `rfq-fanout` worker has
   * created the `rfq_notifications` rows for every current holder; stamped `now()` write-once (enforced by
   * the re-declared `fn_rfqs_guard` — migration `1716000000042`) in the SAME txn as the row inserts. The
   * reconcile sweeper re-drives any RFQ still `NULL` within the window, so this — not row-existence — is the
   * source of truth for "fanned out" (correctly latches the 0-recipient case). Backfilled rows carry
   * `created_at`, NOT a real fan-out time; the SLA metric uses `notif.created_at − rfq.created_at` instead.
   */
  @Column({ name: 'fanned_out_at', type: 'timestamptz', nullable: true })
  fannedOutAt!: Date | null;
}
