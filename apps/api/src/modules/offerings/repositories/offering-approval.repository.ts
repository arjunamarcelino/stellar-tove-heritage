import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { OfferingApproval } from '../entities/offering-approval.entity';
import { Offering } from '../entities/offering.entity';
import {
  ApprovalSummary,
  IOfferingApprovalRepository,
} from './offering-approval-repository.interface';

@Injectable()
export class OfferingApprovalRepository
  extends BaseRepository<OfferingApproval>
  implements IOfferingApprovalRepository
{
  constructor(dataSource: DataSource) {
    super(OfferingApproval, dataSource);
  }

  async insertSignature(
    manager: EntityManager,
    offeringId: string,
    adminSub: string,
  ): Promise<void> {
    // ON CONFLICT DO NOTHING (not a catch): the same admin re-signing (partial-unique on live rows) is a
    // benign no-op. A caught 23505 would ABORT the surrounding transaction in Postgres, breaking the
    // subsequent countLiveSigners in the same txn (the failed-deploy retry path) — so ignore at the SQL layer.
    await manager
      .createQueryBuilder()
      .insert()
      .into(OfferingApproval)
      .values({ offeringId, adminSub })
      .orIgnore()
      .execute();
  }

  async countLiveSigners(
    offeringId: string,
    roster: ReadonlySet<string>,
    manager: EntityManager,
  ): Promise<number> {
    const row = await manager
      .createQueryBuilder(OfferingApproval, 'oa')
      .select('COUNT(*)', 'count')
      .where('oa.offering_id = :offeringId', { offeringId })
      .andWhere('oa.admin_sub = ANY(:roster)', { roster: [...roster] })
      .andWhere('oa.deleted_at IS NULL')
      .getRawOne<{ count: string }>();
    return Number(row?.count ?? 0);
  }

  async softDeleteAllForOffering(manager: EntityManager, offeringId: string): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(OfferingApproval)
      // Bump updated_at too (todo 292): the raw QueryBuilder update does NOT auto-touch @UpdateDateColumn,
      // and every escrow CAS sets it explicitly — match the house pattern so a soft-deleted row's
      // updated_at reflects the soft-delete.
      .set({ deletedAt: () => 'now()', updatedAt: () => 'now()' })
      .where('offering_id = :offeringId AND deleted_at IS NULL', { offeringId })
      .execute();
  }

  async findExpiredOfferingIds(
    ttlMs: number,
    batch: number,
    manager?: EntityManager,
  ): Promise<string[]> {
    // Expiry is an ATTEMPT WINDOW anchored at the FIRST signature (todo 289): an offering is selected once
    // ANY of its live approvals is older than the TTL, and `sweepExpiry` then clears the WHOLE set so a fresh
    // quorum must restart. This is exactly right at the configured threshold of 2 (two approvals reach quorum
    // and deploy, so a set never lingers). It would over-expire a still-fresh sub-quorum vote only at
    // threshold > 2 — which the OFFERING_APPROVAL_THRESHOLD floor keeps at 2 today; revisit (switch to a
    // per-signature TTL) only if a >2 threshold is ever configured.
    // GROUP BY (not SELECT DISTINCT) so we can ORDER BY the oldest approval per offering — Postgres
    // forbids ordering a SELECT DISTINCT by a non-selected expression.
    const qb = manager
      ? manager.createQueryBuilder(OfferingApproval, 'oa')
      : this.repository.createQueryBuilder('oa');
    const rows = await qb
      .select('oa.offering_id', 'offering_id')
      .innerJoin(Offering, 'o', 'o.id = oa.offering_id')
      .where("o.status = 'planned'")
      // Exclude offerings mid-deploy (todo 283): a wedged `deploying` row keeps status='planned', so
      // without this the expiry sweep would wipe the very approvals the stale-deploying re-drive relies on.
      .andWhere('o.escrow_deploy_status IS NULL')
      .andWhere('o.deleted_at IS NULL')
      .andWhere('oa.deleted_at IS NULL')
      .andWhere('oa.created_at < (now() - make_interval(secs => :ttlSecs))', {
        ttlSecs: ttlMs / 1000,
      })
      .groupBy('oa.offering_id')
      .orderBy('MIN(oa.created_at)', 'ASC')
      .limit(batch)
      .getRawMany<{ offering_id: string }>();
    return rows.map((r) => r.offering_id);
  }

  async approvalSummariesFor(
    offeringIds: string[],
    roster: ReadonlySet<string>,
    callerSub: string,
  ): Promise<Map<string, ApprovalSummary>> {
    const summaries = new Map<string, ApprovalSummary>();
    if (offeringIds.length === 0) return summaries;
    const rows = await this.repository
      .createQueryBuilder('oa')
      .select('oa.offering_id', 'offering_id')
      .addSelect('count(*) FILTER (WHERE oa.admin_sub = ANY(:roster))', 'count')
      .addSelect('bool_or(oa.admin_sub = :callerSub)', 'you_approved')
      .where('oa.offering_id = ANY(:ids)', { ids: offeringIds })
      .andWhere('oa.deleted_at IS NULL')
      .setParameters({ roster: [...roster], callerSub })
      .groupBy('oa.offering_id')
      .getRawMany<{ offering_id: string; count: string; you_approved: boolean }>();
    for (const r of rows) {
      summaries.set(r.offering_id, {
        count: Number(r.count),
        youApproved: r.you_approved === true,
      });
    }
    return summaries;
  }
}
