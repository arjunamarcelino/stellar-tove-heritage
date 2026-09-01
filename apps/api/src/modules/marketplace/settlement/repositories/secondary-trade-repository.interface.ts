import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { SecondaryTrade } from '../entities/secondary-trade.entity';

export const SECONDARY_TRADE_REPOSITORY = 'ISecondaryTradeRepository';

/**
 * A new `pending` trade to insert. `gross_stroops` is STORED-generated (DB-computed) → deliberately absent.
 * Money fields are canonical stroop strings; `idempotencyKeyHash` is the 32-byte durable dedup belt.
 */
export interface NewSecondaryTrade {
  rfqId: string;
  quoteId: string;
  buyerSub: string;
  sellerSub: string;
  fractionContractId: string;
  fractionCount: string;
  pricePerFractionStroops: string;
  idempotencyKeyHash: Buffer;
}

/**
 * Secondary-trade ledger port (TOV-177). Mutating methods take an `EntityManager` so they compose inside the
 * settle worker's atomic `runInTransaction`. CAS methods return `boolean` (the win) so the caller can gate the
 * audit write on it (a losing CAS must not double-audit).
 */
export interface ISecondaryTradeRepository extends IBaseRepository<SecondaryTrade> {
  /**
   * Insert a `pending` trade via ON CONFLICT DO NOTHING targeted at `UQ_secondary_trades_idem`
   * `(buyer_sub, rfq_id, idempotency_key_hash)` — a same-key hit returns `null` INSIDE the txn (a caught 23505
   * would abort the surrounding transaction). The caller then replays via `findByIdempotency`. The
   * double-accept latch (`UQ_secondary_trades_pending`) is enforced authoritatively by `findPendingByRfq`
   * under the accept advisory lock BEFORE this insert (the partial-unique index is the belt).
   */
  insertPending(manager: EntityManager, trade: NewSecondaryTrade): Promise<SecondaryTrade | null>;

  /** The live (`pending`) trade on this RFQ, if any — the authoritative double-accept pre-check (→ 409). */
  findPendingByRfq(rfqId: string, manager?: EntityManager): Promise<SecondaryTrade | null>;

  /** Durable-backstop replay after `insertPending` returns `null` (same-key retry past an evicted Redis key). */
  findByIdempotency(
    buyerSub: string,
    rfqId: string,
    idempotencyKeyHash: Buffer,
  ): Promise<SecondaryTrade | null>;

  /**
   * CAS `pending → settled` (+ write-once `settled_at`; `tx_hash` set when known, `null` on the self-heal
   * adopt path where the chain settled but the confirming tx hash isn't in hand). `false` ⇒ lost the CAS.
   */
  casSettled(manager: EntityManager, id: string, patch: { txHash: string | null }): Promise<boolean>;

  /** CAS `pending → failed` (+ `failure_reason`). `false` ⇒ lost the CAS (already terminal). */
  casFailed(manager: EntityManager, id: string, patch: { reason: string }): Promise<boolean>;

  /** The buyer's latest trade on this RFQ (poll target `GET :id/accept/me`). Index-served, no Sort. */
  findLatestForBuyerRfq(buyerSub: string, rfqId: string): Promise<SecondaryTrade | null>;

  /** Reconcile backstop: `pending` trades older than `graceMs`, oldest-first, capped at `batch`. */
  findStalePending(graceMs: number, batch: number): Promise<SecondaryTrade[]>;
}
