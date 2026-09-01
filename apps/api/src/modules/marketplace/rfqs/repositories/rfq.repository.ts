import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Rfq } from '../entities/rfq.entity';
import type { RfqStatus } from '../constants/rfq-status.constant';
import { IRfqRepository, NewRfq } from './rfq-repository.interface';

// Status literal bound as a typed param so a typo is a compile error, not a silently-never-matching filter.
const R_OPEN: RfqStatus = 'open';

@Injectable()
export class RfqRepository extends BaseRepository<Rfq> implements IRfqRepository {
  constructor(dataSource: DataSource) {
    super(Rfq, dataSource);
  }

  async insertOpen(manager: EntityManager, rfq: NewRfq): Promise<Rfq | null> {
    // ON CONFLICT DO NOTHING (NOT a caught 23505 — that aborts the surrounding txn). The conflict target is
    // pinned to UQ_rfqs_idem's columns so ONLY an idempotency-key collision maps to the replay path; a hit on
    // any future-added unique constraint would throw instead of being silently read as a replay. 0 rows → null
    // → the service replays the existing RFQ (idempotent create).
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(Rfq)
      .values({
        collectorSub: rfq.collectorSub,
        artworkId: rfq.artworkId,
        fractionContractId: rfq.fractionContractId,
        fractionCount: rfq.fractionCount,
        maxPricePerFractionStroops: rfq.maxPricePerFractionStroops,
        expiresAt: rfq.expiresAt,
        idempotencyKeyHash: rfq.idempotencyKeyHash,
        status: R_OPEN,
      })
      .orIgnore('("collector_sub", "idempotency_key_hash")')
      .returning(['id'])
      .execute();
    const id = (result.raw as Array<{ id: string }>)[0]?.id;
    if (!id) {
      return null;
    }
    // Re-read via the entity so the caller gets the fully-mapped row (server defaults, timestamps).
    return manager.getRepository(Rfq).findOne({ where: { id } });
  }

  async countActiveOpenByCollector(collectorSub: string): Promise<number> {
    // TypeORM's count() already excludes soft-deleted rows (@DeleteDateColumn), and fn_rfqs_guard blocks
    // soft-delete entirely, so no explicit deleted_at filter is needed. Served by IDX_rfqs_active_open.
    return this.repository.count({
      where: { collectorSub, status: R_OPEN },
    });
  }

  async latchFannedOut(manager: EntityManager, rfqId: string): Promise<boolean> {
    // CAS: only the first writer flips NULL → now(); a concurrent loser affects 0 rows. Also bump updated_at
    // so the row reflects the fan-out. The re-declared fn_rfqs_guard rejects any later re-stamp (write-once).
    const result = await manager
      .createQueryBuilder()
      .update(Rfq)
      .set({ fannedOutAt: () => 'now()', updatedAt: () => 'now()' })
      .where('id = :rfqId AND fanned_out_at IS NULL', { rfqId })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async findUnfannedSince(opts: { windowMs: number; graceMs: number; limit: number }): Promise<string[]> {
    // Un-latched RFQs in [now−windowMs, now−graceMs), oldest-first. The graceMs upper bound skips RFQs whose
    // primary fan-out job may still be running/retrying (avoids a redundant, latch-idempotent re-drive); the
    // windowMs lower bound is the orphan cliff. Served by the partial IDX_rfqs_unfanned as a range scan.
    const now = Date.now();
    const windowStart = new Date(now - opts.windowMs);
    const graceCutoff = new Date(now - opts.graceMs);
    const rows = await this.repository
      .createQueryBuilder('rfq')
      .select('rfq.id', 'id')
      .where('rfq.fanned_out_at IS NULL')
      .andWhere('rfq.deleted_at IS NULL')
      .andWhere('rfq.created_at >= :windowStart', { windowStart })
      .andWhere('rfq.created_at < :graceCutoff', { graceCutoff })
      .orderBy('rfq.created_at', 'ASC')
      .limit(opts.limit)
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  async casFilled(manager: EntityManager, rfqId: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Rfq)
      .set({ status: 'filled', updatedAt: () => 'now()' })
      .where('id = :rfqId AND status = :open', { rfqId, open: R_OPEN })
      .execute();
    return (result.affected ?? 0) === 1;
  }
}
