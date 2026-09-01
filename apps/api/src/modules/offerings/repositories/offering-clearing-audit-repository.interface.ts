import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { OfferingClearingAudit } from '../entities/offering-clearing-audit.entity';
import {
  ClearingAllocationRow,
  ClearingBidSnapshotRow,
} from '../entities/offering-clearing-audit.entity';

export const OFFERING_CLEARING_AUDIT_REPOSITORY = 'IOfferingClearingAuditRepository';

/** The settlement snapshot to record atomically with the `subscribed → settled` CAS (TOV-160). */
export interface NewClearingSnapshot {
  offeringId: string;
  clearingPriceStroops: string;
  publicFloat: string;
  totalDemand: string;
  proceedsStroops: string;
  platformFeeStroops: string;
  artistNetStroops: string;
  // Mint-conservation snapshot (TOV-165) — `clearedAllocations` is the INDEPENDENT Σ of winners; the three
  // supply/retention values are copied from the offering's planning snapshot; `absorbedLeftover` ≡ '0' today.
  clearedAllocationsStroops: string;
  absorbedLeftoverStroops: string;
  totalSupplyStroops: string;
  artistRetentionStroops: string;
  treasuryRetentionStroops: string;
  bidsSnapshot: ClearingBidSnapshotRow[];
  allocationMap: ClearingAllocationRow[];
  settlementTxHash: string | null;
  settledLedger: number | null;
  adopted: boolean;
}

/** Append-only settlement-snapshot ledger port (TOV-160). */
export interface IOfferingClearingAuditRepository extends IBaseRepository<OfferingClearingAudit> {
  /**
   * Insert the settlement snapshot in the caller's txn (alongside `casSettled` + the bid won/lost flip).
   * Uses `.orIgnore()` (never a caught 23505 — that aborts the surrounding txn) but ASSERTS exactly one row
   * was inserted: on the CAS-won branch there must be no pre-existing row (PLAIN `UNIQUE(offering_id)`), so a
   * conflict absorbed to 0 rows means the status would flip to `settled` against a stale/foreign snapshot —
   * a `throw` here rolls the whole settle txn back (F1). Returns the persisted row.
   */
  insertSnapshot(manager: EntityManager, row: NewClearingSnapshot): Promise<OfferingClearingAudit>;

  /** The settlement snapshot for an offering, or `null` (poll/read target). */
  findByOfferingId(offeringId: string): Promise<OfferingClearingAudit | null>;
}
