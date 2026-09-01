import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { OfferingBid } from '../entities/offering-bid.entity';
import { Offering } from '../entities/offering.entity';
import {
  ACTIVE_BID_STATUSES,
  OfferingBidStatus,
} from '../constants/offering-bid-status.constant';
import {
  BidCanceledLatch,
  BidEscrowedLatch,
  BidWonLatch,
  IOfferingBidRepository,
  NewBid,
} from './offering-bid-repository.interface';

// Status literals bound as typed params inside the CAS WHERE clauses (mirror OfferingRepository, todo 290)
// so a typo is a compile error rather than a WHERE that silently never matches (a quiet no-op latch).
const B_SUBMITTED: OfferingBidStatus = 'submitted';
const B_ESCROWED: OfferingBidStatus = 'escrowed';
const B_FAILED: OfferingBidStatus = 'failed';
const B_CANCELING: OfferingBidStatus = 'canceling';
const B_CANCELED: OfferingBidStatus = 'canceled';
const B_WON: OfferingBidStatus = 'won';
const B_LOST: OfferingBidStatus = 'lost';
const B_SETTLING_INFLIGHT: OfferingBidStatus[] = ['submitted', 'canceling'];

@Injectable()
export class OfferingBidRepository
  extends BaseRepository<OfferingBid>
  implements IOfferingBidRepository
{
  constructor(dataSource: DataSource) {
    super(OfferingBid, dataSource);
  }

  async insertSubmitted(manager: EntityManager, bid: NewBid): Promise<OfferingBid | null> {
    // ON CONFLICT DO NOTHING (NOT a caught 23505 — that aborts the surrounding txn). A conflict on either
    // UQ_offering_bids_active_per_collector or UQ_offering_bids_idem yields 0 rows → null → 409 in the service.
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(OfferingBid)
      .values({
        offeringId: bid.offeringId,
        collectorSub: bid.collectorSub,
        collectorWallet: bid.collectorWallet,
        priceStroops: bid.priceStroops,
        count: bid.count,
        idempotencyHash: bid.idempotencyHash,
        status: B_SUBMITTED,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const id = (result.raw as Array<{ id: string }>)[0]?.id;
    if (!id) {
      return null;
    }
    // Re-read via the entity so callers get the mapped row incl. the STORED generated escrow_amount_stroops.
    return manager.getRepository(OfferingBid).findOne({ where: { id } });
  }

  async casEscrowed(
    manager: EntityManager,
    id: string,
    latch: BidEscrowedLatch,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(OfferingBid)
      .set({
        status: B_ESCROWED,
        chainBidId: latch.chainBidId,
        escrowTxHash: latch.txHash,
        updatedAt: () => 'now()',
      })
      .where('id = :id AND status = :submitted', { id, submitted: B_SUBMITTED })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casFailed(manager: EntityManager, id: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(OfferingBid)
      .set({ status: B_FAILED, updatedAt: () => 'now()' })
      .where('id = :id AND status = :submitted', { id, submitted: B_SUBMITTED })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casCanceling(manager: EntityManager, id: string): Promise<boolean> {
    // Claim the cancel: escrowed → canceling. Status only — the refund stamps are written at `canceled`.
    const result = await manager
      .createQueryBuilder()
      .update(OfferingBid)
      .set({ status: B_CANCELING, updatedAt: () => 'now()' })
      .where('id = :id AND status = :escrowed', { id, escrowed: B_ESCROWED })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casCanceled(
    manager: EntityManager,
    id: string,
    latch: BidCanceledLatch,
  ): Promise<boolean> {
    // canceling → canceled, stamping BOTH refund_tx_hash and canceled_at in one UPDATE so
    // CHK_bid_canceled_stamped holds. Frees the active-per-collector slot.
    const result = await manager
      .createQueryBuilder()
      .update(OfferingBid)
      .set({
        status: B_CANCELED,
        refundTxHash: latch.refundTxHash,
        canceledAt: () => 'now()',
        updatedAt: () => 'now()',
      })
      .where('id = :id AND status = :canceling', { id, canceling: B_CANCELING })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casCancelFailedBackToEscrowed(manager: EntityManager, id: string): Promise<boolean> {
    // Money-safe revert: canceling → escrowed. Status ONLY — never touch the write-once escrow/refund stamps
    // (CHK_bid_refund_clean also enforces the reverted row stays stamp-clean).
    const result = await manager
      .createQueryBuilder()
      .update(OfferingBid)
      .set({ status: B_ESCROWED, updatedAt: () => 'now()' })
      .where('id = :id AND status = :canceling', { id, canceling: B_CANCELING })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async findMyActiveBid(offeringId: string, collectorSub: string): Promise<OfferingBid | null> {
    // WHERE mirrors the UQ_offering_bids_active_per_collector predicate so Postgres can use the partial
    // index. Migration …037 also adds a plain (collector_sub, offering_id) WHERE deleted_at IS NULL btree so
    // an Index Scan is guaranteed even under generic plans (PgBouncer) on this unbounded money table.
    return this.repository.findOne({
      where: {
        offeringId,
        collectorSub,
        status: In([...ACTIVE_BID_STATUSES]),
        deletedAt: IsNull(),
      },
    });
  }

  // ── TOV-160 settlement reads + won/lost flip ───────────────────────────────────────────────────────

  async listBidsForClearing(offeringId: string, manager?: EntityManager): Promise<OfferingBid[]> {
    // The uniform-price clearing walk input: ALL `escrowed` bids (funded on-chain, `chain_bid_id` present),
    // ordered `price_stroops DESC, created_at ASC, id ASC`. Served with NO Sort node by the partial index
    // IDX_offering_bids_clearing (…039). `status='escrowed'` is deliberately NOT in the index predicate
    // (mutable → churn/HOT), so there is a residual `Filter: status='escrowed'` over that offering's
    // non-deleted rows (which includes accumulated canceled/lost/won terminals — bounded by cancel throughput,
    // not a hard ≤MAX_BIDS cap). The `id ASC` tail is a deterministic stable scan; `computeClearing` re-sorts
    // internally with `chain_bid_id` as the authoritative FCFS tiebreak (TOV-162 D4′), so this DB order need
    // not mirror it — correctness is unaffected because the algorithm re-sorts.
    const repo = manager ? manager.getRepository(OfferingBid) : this.repository;
    return repo.find({
      where: { offeringId, status: B_ESCROWED, deletedAt: IsNull() },
      order: { priceStroops: 'DESC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  async countInflight(offeringId: string, manager?: EntityManager): Promise<number> {
    // In-flight = a bid whose money movement is unconfirmed (`submitted` = escrow relay pending) or whose
    // refund is in progress (`canceling`). Settlement blocks while any exist so the clearing snapshot reflects
    // the true final book (checked at HTTP AND re-checked in the worker after close_offering).
    const repo = manager ? manager.getRepository(OfferingBid) : this.repository;
    return repo.count({
      where: { offeringId, status: In(B_SETTLING_INFLIGHT), deletedAt: IsNull() },
    });
  }

  async countActiveForOffering(offeringId: string, manager?: EntityManager): Promise<number> {
    // Total ACTIVE bids across all collectors for one offering — the MAX_BIDS_PER_OFFERING cap read on the
    // TOV-156 submit path (the on-chain close_and_settle refunds EVERY active bid in one atomic tx, so the
    // book size has a hard write-ledger-entry ceiling).
    const repo = manager ? manager.getRepository(OfferingBid) : this.repository;
    return repo.count({
      where: { offeringId, status: In([...ACTIVE_BID_STATUSES]), deletedAt: IsNull() },
    });
  }

  async casWon(manager: EntityManager, id: string, latch: BidWonLatch): Promise<boolean> {
    // escrowed → won, stamping allocated_count (>0) + settle_refund_stroops (price-delta) in one UPDATE so
    // CHK_bid_settled_stamped/CHK_bid_won_alloc hold. Frees the active slot (won ∉ active set).
    const result = await manager
      .createQueryBuilder()
      .update(OfferingBid)
      .set({
        status: B_WON,
        allocatedCount: latch.allocatedCount,
        settleRefundStroops: latch.refundStroops,
        updatedAt: () => 'now()',
      })
      .where('id = :id AND status = :escrowed', { id, escrowed: B_ESCROWED })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async flipRemainingEscrowedToLost(manager: EntityManager, offeringId: string): Promise<number> {
    // Bulk-flip every still-`escrowed` bid (the losers — winners were already moved to `won` earlier in the
    // same txn) → lost, allocated 0 + full escrow refund (`settle_refund_stroops = escrow_amount_stroops`).
    // Returns the affected count so the worker can verify the total flipped == the escrowed book size.
    const result = await manager
      .createQueryBuilder()
      .update(OfferingBid)
      .set({
        status: B_LOST,
        allocatedCount: '0',
        settleRefundStroops: () => '"escrow_amount_stroops"',
        updatedAt: () => 'now()',
      })
      .where('offering_id = :offeringId AND status = :escrowed AND deleted_at IS NULL', {
        offeringId,
        escrowed: B_ESCROWED,
      })
      .execute();
    return result.affected ?? 0;
  }

  async findMyLatestBid(offeringId: string, collectorSub: string): Promise<OfferingBid | null> {
    // Most-recent bid regardless of status (the poll target). The IDX_offering_bids_collector
    // (collector_sub, offering_id, created_at DESC) WHERE deleted_at IS NULL btree (…037) serves both the
    // equality filter AND the order, so this is an index-ordered LIMIT 1 (no in-memory Sort). The `id` tiebreak
    // keeps the result deterministic under an exact created_at tie.
    return this.repository.findOne({
      where: { offeringId, collectorSub, deletedAt: IsNull() },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async findSettledWinnerSubsForArtwork(artworkId: string, excludeSub: string): Promise<string[]> {
    // offering_bids has NO artwork_id → join offerings. `won` is terminal + write-once (allocated_count>0 is
    // CHECK-implied, kept as a belt). DISTINCT collapses a collector who won across multiple settled offerings
    // for the same artwork; ORDER BY collector_sub makes the insert set deterministic (deadlock-safe under
    // concurrent workers). Served by IDX_offerings_artwork + IDX_offering_bids_won_recipients (migration 043).
    const rows = await this.repository
      .createQueryBuilder('ob')
      .innerJoin(Offering, 'o', 'o.id = ob.offering_id')
      .select('DISTINCT ob.collector_sub', 'sub')
      .where('o.artwork_id = :artworkId', { artworkId })
      .andWhere('o.deleted_at IS NULL')
      .andWhere('ob.status = :won', { won: B_WON })
      .andWhere('ob.allocated_count > 0')
      .andWhere('ob.deleted_at IS NULL')
      .andWhere('ob.collector_sub <> :excludeSub', { excludeSub })
      .orderBy('sub', 'ASC')
      .getRawMany<{ sub: string }>();
    return rows.map((r) => r.sub);
  }
}
