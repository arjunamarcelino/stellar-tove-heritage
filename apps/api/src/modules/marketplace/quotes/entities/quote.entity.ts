import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import type { QuoteStatus } from '../constants/quote-status.constant';

/**
 * One row per quote a whitelisted holder submits in response to an RFQ (TOV-175, FR-06.03) — an offer to
 * SELL `fraction_count` fractions at `price_per_fraction_stroops` each, valid until `valid_until`. Created
 * `open`; the later accept-and-settle FR transitions it (`accepted`/`canceled`/`expired`). Pure DB record at
 * submit — no on-chain leg (the fraction transfer/escrow happens at accept-and-settle). Money amounts are
 * `numeric(39,0)` → bigint-safe strings in TypeORM.
 *
 * Under `synchronize:false` the migration (`1716000000044`) is authoritative for the CHECK belts, the
 * composite FK `(rfq_id, fraction_contract_id) → rfqs(id, fraction_contract_id)` (snapshot-drift protection),
 * the full-unique dedup index `UQ_quotes_idem`, the partial-unique active-per-RFQ index
 * `UQ_quotes_active_per_rfq`, and the immutability guard trigger (`fn_quotes_guard` freezes the money-intent
 * columns + blocks delete/soft-delete + allows forward-only status transitions). This entity mirrors the shape.
 */
@Entity({ name: 'rfq_quotes' })
export class Quote extends BaseEntity {
  /** The RFQ this quote answers. Part of the composite FK to `rfqs(id, fraction_contract_id)`. */
  @Column({ name: 'rfq_id', type: 'uuid' })
  rfqId!: string;

  /** The quoting holder's verified JWT `sub`. Audit-actor semantics → intentionally no FK to `users`. */
  @Column({ name: 'holder_sub', type: 'uuid' })
  holderSub!: string;

  /**
   * The RFQ's fraction contract, snapshotted at submit. Denormalized (feeds the cross-RFQ locked-sum) but
   * non-forgeable: the composite FK guarantees it equals the parent RFQ's `fraction_contract_id`.
   */
  @Column({ name: 'fraction_contract_id', type: 'uuid' })
  fractionContractId!: string;

  /** Number of fractions the holder offers to sell (i128, decimals=0). numeric → string. */
  @Column({ name: 'fraction_count', type: 'numeric', precision: 39, scale: 0 })
  fractionCount!: string;

  /** The holder's ask per fraction (USDC stroops, i128). numeric → string. */
  @Column({ name: 'price_per_fraction_stroops', type: 'numeric', precision: 39, scale: 0 })
  pricePerFractionStroops!: string;

  /** Quote validity deadline, silently capped to the RFQ's `expires_at` at submit. No background sweeper yet. */
  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil!: Date;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'open' })
  status!: QuoteStatus;

  /**
   * Machine-readable reason a quote left `open` other than by acceptance (TOV-177): e.g.
   * `seller_balance_insufficient`/`seller_lockup`/`seller_auth_lapsed` on a settlement revert (status→`expired`).
   * NULL for `open`/`accepted` quotes. Mutable — not in the guard's freeze list.
   */
  @Column({ name: 'status_reason', type: 'varchar', length: 48, nullable: true })
  statusReason!: string | null;

  /**
   * The seller's signed `SorobanAuthorizationEntry` XDR for `accept_quote` (TOV-177). Captured at the
   * seller-authorize step and replayed server-side at accept. NULL until authorized; re-writable if it lapses.
   * A quote is "acceptable" only while `open` AND this is present AND `valid_until > now()`. NEVER exposed via API.
   */
  @Column({ name: 'seller_auth_entry', type: 'bytea', nullable: true })
  sellerAuthEntry!: Buffer | null;

  /** The stored seller entry's `signatureExpirationLedger` (bigint → string). NULL until authorized. */
  @Column({ name: 'seller_auth_expires_ledger', type: 'bigint', nullable: true })
  sellerAuthExpiresLedger!: string | null;

  /** The seller's RECORDED embedded-wallet contract (`C…`) at authorize time — pinned so a later rotation
   * can't strand the stored signature against a fresh wallet. NULL until authorized. */
  @Column({ name: 'seller_wallet_contract', type: 'varchar', length: 56, nullable: true })
  sellerWalletContract!: string | null;

  /** When the seller authorized this quote. NULL until authorized. */
  @Column({ name: 'authorized_at', type: 'timestamptz', nullable: true })
  authorizedAt!: Date | null;

  /**
   * Durable idempotency dedup belt = sha256(`holderSub|rfqId|Idempotency-Key`). Persisted with the full-unique
   * index `UQ_quotes_idem (holder_sub, rfq_id, idempotency_key_hash)`, so a crash between the DB commit and the
   * Redis `complete()` cannot double-create — a same-key retry hits the constraint and replays the existing row.
   */
  @Column({ name: 'idempotency_key_hash', type: 'bytea' })
  idempotencyKeyHash!: Buffer;
}
