import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
} from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Offering } from '../entities/offering.entity';
import {
  ACTIVE_OFFERING_STATUSES,
  EscrowDeployStatus,
  OfferingStatus,
} from '../constants/offering-status.constant';
import {
  EscrowDeployedLatch,
  IOfferingRepository,
} from './offering-repository.interface';

// Status literals used inside the CAS WHERE clauses, bound as typed params (todo 290) so a typo is a
// compile error rather than a WHERE that silently never matches (a quiet no-op latch).
const S_PLANNED: OfferingStatus = 'planned';
const S_APPROVED: OfferingStatus = 'approved';
const S_OPENED: OfferingStatus = 'opened';
const S_SUBSCRIBED: OfferingStatus = 'subscribed';
const D_DEPLOYING: EscrowDeployStatus = 'deploying';
const D_FAILED: EscrowDeployStatus = 'failed';

@Injectable()
export class OfferingRepository
  extends BaseRepository<Offering>
  implements IOfferingRepository
{
  constructor(dataSource: DataSource) {
    super(Offering, dataSource);
  }

  // Mirrors FractionContractRepository.findActiveByArtworkId. The partial-unique index
  // UQ_offerings_active_per_artwork guarantees ≤1 active row per artwork, so findOne is deterministic.
  // NB: offerings has NO plain (artwork_id) btree (migration 032 declines it) — this read relies on the
  // partial index, which Postgres uses only when it can prove the query's `status IN (...)` implies the
  // index predicate. That holds under custom plans (param values folded in), the default here. If a
  // statement cache / generic plans / PgBouncer are ever introduced, re-check with EXPLAIN or add a plain
  // (artwork_id) index — else this would silently fall back to a seq scan.
  async findActiveByArtworkId(artworkId: string): Promise<Offering | null> {
    return this.repository.findOne({
      where: { artworkId, status: In([...ACTIVE_OFFERING_STATUSES]), deletedAt: IsNull() },
    });
  }

  // ── TOV-154 escrow-deploy dual-latch CAS surface (mirrors FractionContractRepository) ──────────────

  async casEscrowDeploying(manager: EntityManager, id: string): Promise<boolean> {
    // IS NULL (never `= NULL`, three-valued-logic trap); accepts 'failed' so a rostered signer can retry.
    const result = await manager
      .createQueryBuilder()
      .update(Offering)
      .set({ escrowDeployStatus: 'deploying', updatedAt: () => 'now()' })
      .where(
        'id = :id AND status = :planned AND (escrow_deploy_status IS NULL OR escrow_deploy_status = :failed)',
        { id, planned: S_PLANNED, failed: D_FAILED },
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casEscrowDeployed(
    manager: EntityManager,
    id: string,
    latch: EscrowDeployedLatch,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Offering)
      .set({
        escrowDeployStatus: 'deployed',
        escrowContractAddress: latch.address,
        status: 'approved',
        updatedAt: () => 'now()',
      })
      // `AND status = :planned` (todo 288): self-defend the state machine — a future cancel path that sets
      // status='canceled' during an in-flight deploy must not be silently resurrected to 'approved'.
      .where('id = :id AND escrow_deploy_status = :deploying AND status = :planned', {
        id,
        deploying: D_DEPLOYING,
        planned: S_PLANNED,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casEscrowFailed(manager: EntityManager, id: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Offering)
      .set({ escrowDeployStatus: 'failed', updatedAt: () => 'now()' })
      .where('id = :id AND escrow_deploy_status = :deploying', { id, deploying: D_DEPLOYING })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casOpened(manager: EntityManager, id: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Offering)
      .set({ status: 'opened', updatedAt: () => 'now()' })
      // `AND window_close_at > now()` (todo 288): planning allows a past window_open_at, so never auto-open
      // an offering whose entire window has already elapsed — it stays `approved` for an admin/later FR.
      .where(
        'id = :id AND status = :approved AND window_open_at <= now() AND window_close_at > now()',
        { id, approved: S_APPROVED },
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }

  // ── TOV-160 settlement CAS surface (opened → subscribed → settled) ─────────────────────────────────

  async casSubscribed(manager: EntityManager, id: string): Promise<boolean> {
    // Latch the settle: opened → subscribed, guarded on a CLOSED bidding window. `updatedAt` becomes the
    // staleness anchor for the reconcile re-drive (findStaleSubscribed).
    const result = await manager
      .createQueryBuilder()
      .update(Offering)
      .set({ status: 'subscribed', updatedAt: () => 'now()' })
      .where('id = :id AND status = :opened AND window_close_at <= now()', { id, opened: S_OPENED })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casSettled(manager: EntityManager, id: string): Promise<boolean> {
    // Terminal success: subscribed → settled. Clears any prior settle-failure stamp (a re-drive after a
    // terminal failure that was since fixed). The offering_clearing_audit insert rides in the SAME txn.
    const result = await manager
      .createQueryBuilder()
      .update(Offering)
      .set({
        status: 'settled',
        settleFailedAt: null,
        settleFailureReason: null,
        updatedAt: () => 'now()',
      })
      .where('id = :id AND status = :subscribed', { id, subscribed: S_SUBSCRIBED })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async setSettleFailureStamp(
    manager: EntityManager,
    id: string,
    reason: string | null,
  ): Promise<boolean> {
    // One method for both directions of the settle-failure stamp on a `subscribed` row (#330):
    //  - reason != null (STAMP): record a TERMINAL failure but LEAVE the offering `subscribed` (never
    //    partially settled — the tx is atomic). Distinguishes wedged/failed from in-progress at GET :id and
    //    EXCLUDES the row from the stale-subscribed reconcile (a deterministic failure won't self-heal).
    //  - reason == null (RECLAIM): an admin re-drive after fixing the cause clears the stamps so the row is
    //    settle-able again + re-enters the sweep; additionally guarded on `settle_failed_at IS NOT NULL` so it
    //    only ever touches a genuinely-failed row (never an in-progress/unstamped one).
    const qb = manager
      .createQueryBuilder()
      .update(Offering)
      .set({
        settleFailedAt: reason === null ? null : () => 'now()',
        settleFailureReason: reason,
        updatedAt: () => 'now()',
      })
      .where('id = :id AND status = :subscribed', { id, subscribed: S_SUBSCRIBED });
    if (reason === null) {
      qb.andWhere('settle_failed_at IS NOT NULL');
    }
    const result = await qb.execute();
    return (result.affected ?? 0) > 0;
  }

  async findStaleSubscribed(graceMs: number, batch: number, manager?: EntityManager): Promise<Offering[]> {
    // A row wedged in `subscribed` past the grace window with NO settle-failure stamp = the crash-between-
    // commit-and-enqueue window (the job was never enqueued, so BullMQ attempts can't recover it). Re-driven
    // by the settle reconcile sweep; the worker is idempotent (self-heal-first readStatus). Terminally-failed
    // rows (settle_failed_at set) are EXCLUDED — they need an admin re-drive, not an auto-retry loop.
    const repo = manager ? manager.getRepository(Offering) : this.repository;
    const cutoff = new Date(Date.now() - graceMs);
    return repo.find({
      where: {
        status: 'subscribed',
        settleFailedAt: IsNull(),
        updatedAt: LessThan(cutoff),
        deletedAt: IsNull(),
      },
      order: { updatedAt: 'ASC' },
      take: batch,
    });
  }

  async setSnapshotArtistAddress(
    manager: EntityManager,
    id: string,
    addr: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Offering)
      .set({ snapshotArtistAddress: addr, updatedAt: () => 'now()' })
      .where('id = :id', { id })
      .execute();
  }

  async findDueForOpen(batch: number, manager?: EntityManager): Promise<Offering[]> {
    const repo = manager ? manager.getRepository(Offering) : this.repository;
    const now = new Date();
    return repo.find({
      // Exclude already-expired windows (todo 288) so the sweep matches the casOpened guard.
      where: {
        status: 'approved',
        windowOpenAt: LessThanOrEqual(now),
        windowCloseAt: MoreThan(now),
        deletedAt: IsNull(),
      },
      order: { windowOpenAt: 'ASC' },
      take: batch,
    });
  }

  // TOV-154 P1 (todo 283): a row stuck in `deploying` past the grace window has no live job — the enqueue
  // failed after the approve txn committed, or BullMQ exhausted its attempts. The stale-deploying reconcile
  // sweep re-drives these (the deploy processor + adapter self-heal make a re-run idempotent). `updatedAt`
  // is when the row entered `deploying` (set by casEscrowDeploying), so it is the correct staleness anchor.
  async findStaleDeploying(graceMs: number, batch: number, manager?: EntityManager): Promise<Offering[]> {
    const repo = manager ? manager.getRepository(Offering) : this.repository;
    const cutoff = new Date(Date.now() - graceMs);
    return repo.find({
      where: { escrowDeployStatus: 'deploying', updatedAt: LessThan(cutoff), deletedAt: IsNull() },
      order: { updatedAt: 'ASC' },
      take: batch,
    });
  }

  async listForBackoffice(opts: {
    statuses: readonly OfferingStatus[];
    artworkId?: string;
    page: number;
    limit: number;
  }): Promise<[Offering[], number]> {
    const { statuses, artworkId, page, limit } = opts;
    const where: FindOptionsWhere<Offering> = {
      status: In([...statuses]),
      deletedAt: IsNull(),
    };
    if (artworkId) where.artworkId = artworkId;
    return this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }
}
