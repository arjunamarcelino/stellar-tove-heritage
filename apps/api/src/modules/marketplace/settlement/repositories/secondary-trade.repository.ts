import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { SecondaryTrade } from '../entities/secondary-trade.entity';
import type { SecondaryTradeStatus } from '../constants/secondary-trade-status.constant';
import {
  ISecondaryTradeRepository,
  NewSecondaryTrade,
} from './secondary-trade-repository.interface';

// Status literals bound as typed params so a typo is a compile error, not a silently-never-matching filter.
const T_PENDING: SecondaryTradeStatus = 'pending';
const T_SETTLED: SecondaryTradeStatus = 'settled';
const T_FAILED: SecondaryTradeStatus = 'failed';

@Injectable()
export class SecondaryTradeRepository
  extends BaseRepository<SecondaryTrade>
  implements ISecondaryTradeRepository
{
  constructor(dataSource: DataSource) {
    super(SecondaryTrade, dataSource);
  }

  async insertPending(
    manager: EntityManager,
    trade: NewSecondaryTrade,
  ): Promise<SecondaryTrade | null> {
    // ON CONFLICT DO NOTHING pinned to UQ_secondary_trades_idem (NOT a caught 23505 — that aborts the txn). A
    // same-Idempotency-Key retry → 0 rows → null → the service replays via findByIdempotency. The pending
    // double-accept latch is enforced by findPendingByRfq under the advisory lock BEFORE this insert.
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(SecondaryTrade)
      .values({ ...trade, status: T_PENDING })
      .orIgnore('("buyer_sub", "rfq_id", "idempotency_key_hash")')
      .returning('*')
      .execute();
    // ON-CONFLICT DO NOTHING → `raw` is empty (generatedMaps is [{}], NOT [] — don't gate on it).
    if ((result.raw as unknown[]).length === 0) {
      return null;
    }
    return result.generatedMaps[0] as SecondaryTrade;
  }

  async findPendingByRfq(rfqId: string, manager?: EntityManager): Promise<SecondaryTrade | null> {
    // Served by UQ_secondary_trades_pending (rfq_id) WHERE status='pending' AND deleted_at IS NULL. With the
    // txn manager it is the authoritative under-advisory-lock check; without it, a cheap fast-fail.
    const qb = manager
      ? manager.createQueryBuilder(SecondaryTrade, 't')
      : this.repository.createQueryBuilder('t');
    return qb
      .where('t.rfq_id = :rfqId', { rfqId })
      .andWhere('t.status = :pending', { pending: T_PENDING })
      .andWhere('t.deleted_at IS NULL')
      .getOne();
  }

  async findByIdempotency(
    buyerSub: string,
    rfqId: string,
    idempotencyKeyHash: Buffer,
  ): Promise<SecondaryTrade | null> {
    return this.repository.findOne({ where: { buyerSub, rfqId, idempotencyKeyHash } });
  }

  async casSettled(
    manager: EntityManager,
    id: string,
    patch: { txHash: string | null },
  ): Promise<boolean> {
    // CAS: only a still-`pending` row flips; a concurrent/replayed winner affects 0 rows. Write-once tx_hash /
    // settled_at (NULL→value) are permitted by fn_secondary_trades_guard.
    const result = await manager
      .createQueryBuilder()
      .update(SecondaryTrade)
      .set({ status: T_SETTLED, txHash: patch.txHash, settledAt: () => 'now()', updatedAt: () => 'now()' })
      .where('id = :id AND status = :pending', { id, pending: T_PENDING })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async casFailed(manager: EntityManager, id: string, patch: { reason: string }): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(SecondaryTrade)
      .set({ status: T_FAILED, failureReason: patch.reason, updatedAt: () => 'now()' })
      .where('id = :id AND status = :pending', { id, pending: T_PENDING })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async findLatestForBuyerRfq(buyerSub: string, rfqId: string): Promise<SecondaryTrade | null> {
    // Index-served by IDX_secondary_trades_me (buyer_sub, rfq_id, created_at DESC, id DESC) WHERE deleted_at
    // IS NULL — the ORDER BY direction-for-direction matches the index → no Sort node (EXPLAIN-asserted).
    return this.repository
      .createQueryBuilder('t')
      .where('t.buyer_sub = :buyerSub', { buyerSub })
      .andWhere('t.rfq_id = :rfqId', { rfqId })
      .andWhere('t.deleted_at IS NULL')
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .limit(1)
      .getOne();
  }

  async findStalePending(graceMs: number, batch: number): Promise<SecondaryTrade[]> {
    // Stale pending trades (created before now−graceMs), oldest-first. Served by IDX_secondary_trades_stale as
    // a range scan; self-shrinking (rows leave the partial index as they go terminal).
    const cutoff = new Date(Date.now() - graceMs);
    return this.repository
      .createQueryBuilder('t')
      .where('t.status = :pending', { pending: T_PENDING })
      .andWhere('t.deleted_at IS NULL')
      .andWhere('t.created_at < :cutoff', { cutoff })
      .orderBy('t.created_at', 'ASC')
      .limit(batch)
      .getMany();
  }

  /** Soft-delete is unsupported: `fn_secondary_trades_guard` blocks any `deleted_at` change (a raw 500). */
  override softRemove(): Promise<never> {
    return Promise.reject(
      new Error('secondary_trades rows are immutable; soft-delete is not supported (fn_secondary_trades_guard)'),
    );
  }
}
