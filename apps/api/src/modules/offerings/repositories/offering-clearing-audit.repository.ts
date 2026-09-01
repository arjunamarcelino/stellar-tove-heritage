import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { OfferingClearingAudit } from '../entities/offering-clearing-audit.entity';
import {
  IOfferingClearingAuditRepository,
  NewClearingSnapshot,
} from './offering-clearing-audit-repository.interface';

@Injectable()
export class OfferingClearingAuditRepository
  extends BaseRepository<OfferingClearingAudit>
  implements IOfferingClearingAuditRepository
{
  constructor(dataSource: DataSource) {
    super(OfferingClearingAudit, dataSource);
  }

  async insertSnapshot(
    manager: EntityManager,
    row: NewClearingSnapshot,
  ): Promise<OfferingClearingAudit> {
    // ON CONFLICT DO NOTHING (never a caught 23505 — aborts the txn). On the CAS-won branch a conflict is
    // impossible (plain UNIQUE(offering_id) + first-ever subscribed→settled), so 0 rows ⇒ a stale/foreign
    // snapshot would be silently accepted while status flips → throw to roll the whole settle txn back (F1).
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(OfferingClearingAudit)
      .values({
        offeringId: row.offeringId,
        clearingPriceStroops: row.clearingPriceStroops,
        publicFloat: row.publicFloat,
        totalDemand: row.totalDemand,
        proceedsStroops: row.proceedsStroops,
        platformFeeStroops: row.platformFeeStroops,
        artistNetStroops: row.artistNetStroops,
        clearedAllocationsStroops: row.clearedAllocationsStroops,
        absorbedLeftoverStroops: row.absorbedLeftoverStroops,
        totalSupplyStroops: row.totalSupplyStroops,
        artistRetentionStroops: row.artistRetentionStroops,
        treasuryRetentionStroops: row.treasuryRetentionStroops,
        bidsSnapshot: row.bidsSnapshot,
        allocationMap: row.allocationMap,
        settlementTxHash: row.settlementTxHash,
        settledLedger: row.settledLedger,
        adopted: row.adopted,
        clearedAt: () => 'now()',
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const id = (result.raw as Array<{ id: string }>)[0]?.id;
    if (!id) {
      throw new Error(
        `offering_clearing_audit insert affected 0 rows for offering ${row.offeringId} ` +
          '(a settlement snapshot already exists — refusing to settle against a stale snapshot)',
      );
    }
    const saved = await manager.getRepository(OfferingClearingAudit).findOne({ where: { id } });
    if (!saved) {
      throw new Error(`offering_clearing_audit row ${id} vanished after insert`);
    }
    return saved;
  }

  async findByOfferingId(offeringId: string): Promise<OfferingClearingAudit | null> {
    return this.repository.findOne({ where: { offeringId, deletedAt: IsNull() } });
  }
}
