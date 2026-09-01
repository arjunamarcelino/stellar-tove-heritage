import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { Rfq } from '../entities/rfq.entity';

export const RFQ_REPOSITORY = 'IRfqRepository';

/** A new RFQ to insert (the repo forces `status='open'`). Money fields are canonical stroop strings. */
export interface NewRfq {
  collectorSub: string;
  artworkId: string;
  fractionContractId: string;
  fractionCount: string;
  maxPricePerFractionStroops: string;
  expiresAt: Date;
  idempotencyKeyHash: Buffer;
}

/**
 * RFQ ledger port (TOV-172). `insertOpen` takes an `EntityManager` so it composes inside `runInTransaction`
 * alongside the audit write; `countActiveOpenByCollector` powers the per-collector active-open ceiling.
 */
export interface IRfqRepository extends IBaseRepository<Rfq> {
  /**
   * Insert an `open` RFQ via ON CONFLICT DO NOTHING targeted at `UQ_rfqs_idem`
   * `(collector_sub, idempotency_key_hash)` — a hit returns `null` INSIDE the txn (a caught 23505 would abort
   * the surrounding transaction; do not use one). The conflict target is explicit so only an idempotency-key
   * collision maps to the replay path. The service then replays the existing row. Returns the row on success.
   */
  insertOpen(manager: EntityManager, rfq: NewRfq): Promise<Rfq | null>;

  /** Count of the collector's currently-`open` RFQs (all artworks) — the MAX_ACTIVE_OPEN_RFQS ceiling read. */
  countActiveOpenByCollector(collectorSub: string): Promise<number>;

  /**
   * Notification fan-out completion latch (TOV-174). CAS `UPDATE rfqs SET fanned_out_at = now() WHERE id AND
   * fanned_out_at IS NULL`, in the caller's txn (composes with the notification inserts). Returns true iff
   * THIS writer stamped it — so the caller gates the single audit row on the win (a losing concurrent worker
   * gets false and must not re-audit). The re-declared `fn_rfqs_guard` enforces write-once at the DB.
   */
  latchFannedOut(manager: EntityManager, rfqId: string): Promise<boolean>;

  /**
   * Reconcile backstop read: un-latched RFQ ids in `[now−windowMs, now−graceMs)`, oldest-first, capped at
   * `limit`. The `graceMs` lower bound skips RFQs whose primary fan-out job may still be running/retrying (so
   * the sweep only re-drives genuinely-stalled ones); `windowMs` is the orphan cliff. Served by the partial
   * `IDX_rfqs_unfanned (created_at) WHERE fanned_out_at IS NULL`. Returns ids only (reconcile re-enqueues by id).
   */
  findUnfannedSince(opts: { windowMs: number; graceMs: number; limit: number }): Promise<string[]>;

  /** CAS `open → filled` on a settled RFQ (TOV-177). `false` ⇒ no longer open (best-effort at settle). */
  casFilled(manager: EntityManager, rfqId: string): Promise<boolean>;
}
