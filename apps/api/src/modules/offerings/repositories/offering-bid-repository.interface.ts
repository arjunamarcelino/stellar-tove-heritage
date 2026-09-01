import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { OfferingBid } from '../entities/offering-bid.entity';

export const OFFERING_BID_REPOSITORY = 'IOfferingBidRepository';

/** Values latched onto a bid when its on-chain `submit_bid` confirms (TOV-156). */
export interface BidEscrowedLatch {
  chainBidId: number;
  txHash: string;
}

/** Value latched onto a bid when its on-chain `cancel_bid` refund confirms (TOV-158). */
export interface BidCanceledLatch {
  refundTxHash: string;
}

/** Values latched onto a WINNING bid at settlement (TOV-160). Canonical stroop/count strings. */
export interface BidWonLatch {
  /** Fractions won on-chain (`> 0`). */
  allocatedCount: string;
  /** Price-delta USDC refunded to the winner: `escrow − clearing_price·allocated` (`>= 0`). */
  refundStroops: string;
}

/** A new bid to insert (the repo forces `status='submitted'`). Money fields are canonical stroop strings. */
export interface NewBid {
  offeringId: string;
  collectorSub: string;
  collectorWallet: string;
  priceStroops: string;
  count: string;
  idempotencyHash: Buffer;
}

/**
 * Bid ledger port (TOV-156). CAS methods take an `EntityManager` first so they compose inside
 * `runInTransaction` alongside the audit write; they mirror the `OfferingRepository` dual-latch style.
 */
export interface IOfferingBidRepository extends IBaseRepository<OfferingBid> {
  /**
   * Insert a `submitted` bid via ON CONFLICT DO NOTHING (`.orIgnore()`) — a hit on
   * `UQ_offering_bids_active_per_collector` OR `UQ_offering_bids_idem` returns `null` INSIDE the txn (a
   * caught 23505 would abort the surrounding transaction; do not use one). Returns the row on success.
   */
  insertSubmitted(manager: EntityManager, bid: NewBid): Promise<OfferingBid | null>;

  /**
   * CAS `status 'submitted' → 'escrowed'` + stamp `chain_bid_id`/`escrow_tx_hash` in one UPDATE. Returns
   * true iff this writer won (a reconcile re-drive or duplicate job already latched → false).
   */
  casEscrowed(manager: EntityManager, id: string, latch: BidEscrowedLatch): Promise<boolean>;

  /** CAS `status 'submitted' → 'failed'` (terminal). Returns true iff this writer won. */
  casFailed(manager: EntityManager, id: string): Promise<boolean>;

  /**
   * CAS `status 'escrowed' → 'canceling'` (TOV-158) — claims the cancel so the async refund worker can run;
   * the loser of a concurrent double-cancel gets `false` → 409. Touches status only (stamps come at `canceled`).
   */
  casCanceling(manager: EntityManager, id: string): Promise<boolean>;

  /**
   * CAS `status 'canceling' → 'canceled'` + stamp `refund_tx_hash`/`canceled_at` in one UPDATE (TOV-158).
   * Returns true iff this writer won. Frees the one-active-bid slot (`canceled` ∉ active set).
   */
  casCanceled(manager: EntityManager, id: string, latch: BidCanceledLatch): Promise<boolean>;

  /**
   * CAS `status 'canceling' → 'escrowed'` (TOV-158) — the money-safe revert on a provably-no-refund failure
   * (or self-heal on signature expiry). Status ONLY (never touches the write-once escrow/refund stamps);
   * `CHK_bid_refund_clean` structurally guarantees no refund stamp leaks onto the reverted row.
   */
  casCancelFailedBackToEscrowed(manager: EntityManager, id: string): Promise<boolean>;

  // ── TOV-160 settlement reads + won/lost flip ────────────────────────────────────────────────────────

  /**
   * All `escrowed` bids for an offering in DB scan order (`price_stroops DESC, created_at ASC, id ASC`); served
   * with no Sort node by `IDX_offering_bids_clearing` (…039). The pure clearing algorithm's input — it re-sorts
   * internally with `chain_bid_id` as the authoritative FCFS tiebreak (TOV-162 D4′), so the `id ASC` DB tail is
   * a stable-scan detail, not the algorithm's tiebreak.
   */
  listBidsForClearing(offeringId: string, manager?: EntityManager): Promise<OfferingBid[]>;

  /** Count of in-flight bids (`submitted|canceling`) for an offering — settlement blocks while any exist. */
  countInflight(offeringId: string, manager?: EntityManager): Promise<number>;

  /** Total ACTIVE bids for an offering (all collectors) — the MAX_BIDS_PER_OFFERING cap read (submit path). */
  countActiveForOffering(offeringId: string, manager?: EntityManager): Promise<number>;

  /**
   * CAS `status 'escrowed' → 'won'` + stamp `allocated_count`/`settle_refund_stroops` in one UPDATE. Called
   * per winner inside the settle txn (after the offering's `casSettled`). Returns true iff this writer won.
   */
  casWon(manager: EntityManager, id: string, latch: BidWonLatch): Promise<boolean>;

  /**
   * Bulk-flip every remaining `escrowed` bid → `lost` (allocated 0, full escrow refund) — the losers, after
   * the winners were moved to `won`. Returns the affected count (for a total-flipped == book-size assertion).
   */
  flipRemainingEscrowedToLost(manager: EntityManager, offeringId: string): Promise<number>;

  /** The caller's single active (`submitted|escrowed|canceling`) bid on an offering, or `null`. */
  findMyActiveBid(offeringId: string, collectorSub: string): Promise<OfferingBid | null>;

  /**
   * DISTINCT settled-offering WINNERS for an artwork (TOV-174 RFQ fan-out recipients). Joins `offerings`
   * (offering_bids has no artwork_id) and filters `status='won' AND allocated_count>0`, excluding
   * `excludeSub` (the RFQ issuer). Ordered by `collector_sub` for a deterministic insert set. Served by
   * `IDX_offerings_artwork` + `IDX_offering_bids_won_recipients` (migration 043). Returns the winner subs.
   */
  findSettledWinnerSubsForArtwork(artworkId: string, excludeSub: string): Promise<string[]>;

  /**
   * The caller's MOST-RECENT bid on an offering (any status, incl. terminal `canceled`/`failed`), or `null`.
   * The `GET :id/bids/me` poll target (TOV-158): unlike `findMyActiveBid` it can observe `canceling → canceled`
   * and surface `refund_tx_hash`/`canceled_at`. The one-active-bid invariant stays enforced by the DB index,
   * not by this read.
   */
  findMyLatestBid(offeringId: string, collectorSub: string): Promise<OfferingBid | null>;
}
