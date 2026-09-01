import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { OfferingApproval } from '../entities/offering-approval.entity';

export const OFFERING_APPROVAL_REPOSITORY = 'IOfferingApprovalRepository';

/** One offering's approval tally for the list/detail projection (roster-intersected count + caller flag). */
export interface ApprovalSummary {
  count: number;
  youApproved: boolean;
}

export interface IOfferingApprovalRepository extends IBaseRepository<OfferingApproval> {
  /**
   * Record one approval "signature" for `(offeringId, adminSub)` in the caller's txn. A 23505 on the
   * partial-unique `(offering_id, admin_sub) WHERE deleted_at IS NULL` means the same admin already
   * signed — a benign, idempotent replay — so it is swallowed. Any other error rethrows.
   */
  insertSignature(manager: EntityManager, offeringId: string, adminSub: string): Promise<void>;

  /**
   * `COUNT(*)` of live rows for the offering whose `admin_sub` is in the current signer `roster`
   * (Enhancement #2 — a removed admin's retained row must NOT count). `manager` is required: the
   * quorum count runs inside the `FOR UPDATE` approval txn. The partial-unique already guarantees ≤1
   * live row per signer, so `COUNT(*)` (not `COUNT(DISTINCT)`) is correct.
   */
  countLiveSigners(
    offeringId: string,
    roster: ReadonlySet<string>,
    manager: EntityManager,
  ): Promise<number>;

  /** Soft-delete (`deleted_at = now()`) every live approval for the offering, in the caller's txn. */
  softDeleteAllForOffering(manager: EntityManager, offeringId: string): Promise<void>;

  /**
   * DISTINCT offering ids whose still-`planned` offering has a live approval older than `ttlMs`,
   * oldest-approval first, capped at `batch` (the 7d expiry sweep; driven by `IDX_offering_approvals_expiry`).
   */
  findExpiredOfferingIds(
    ttlMs: number,
    batch: number,
    manager?: EntityManager,
  ): Promise<string[]>;

  /**
   * Batched (N+1-free) approval tallies for a set of offerings — ONE query. Per offering: the
   * roster-intersected live `count` and whether `callerSub` is among the live signers (`youApproved`).
   * Offerings with no live approvals are absent from the map (caller defaults to `{count:0, youApproved:false}`).
   */
  approvalSummariesFor(
    offeringIds: string[],
    roster: ReadonlySet<string>,
    callerSub: string,
  ): Promise<Map<string, ApprovalSummary>>;
}
