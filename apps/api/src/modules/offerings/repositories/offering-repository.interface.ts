import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { Offering } from '../entities/offering.entity';
import { OfferingStatus } from '../constants/offering-status.constant';

export const OFFERING_REPOSITORY = 'IOfferingRepository';

/** Values latched onto an offering when its escrow deploy succeeds (TOV-154). */
export interface EscrowDeployedLatch {
  address: string;
}

/**
 * The TOV-152 write path adds no custom methods (its only writes are `create`/`save`/`runInTransaction`
 * from `IBaseRepository`; uniqueness is DB-enforced via the partial-unique index + 23505 catch, not a
 * pre-check read). TOV-153 adds `findActiveByArtworkId` for the artwork-detail `activeOffering` embed.
 * TOV-154 adds the escrow-deploy dual-latch CAS surface (below) — FROZEN: consumed by the approval
 * service (WS6/WS9), the deploy worker (WS7), and the reconcile sweeps (WS8); do not change signatures.
 */
export interface IOfferingRepository extends IBaseRepository<Offering> {
  /**
   * The single non-terminal (active) offering for an artwork, or `null`. At most one exists — guaranteed
   * by `UQ_offerings_active_per_artwork` — so no ordering/tie-break is needed.
   */
  findActiveByArtworkId(artworkId: string): Promise<Offering | null>;

  /**
   * CAS-claim the escrow deploy: `escrow_deploy_status NULL|failed → deploying`, gated on `status='planned'`.
   * Uses `IS NULL` (never `= NULL`). The enqueue-once guard — returns true iff this writer won the claim.
   */
  casEscrowDeploying(manager: EntityManager, id: string): Promise<boolean>;

  /**
   * CAS the success latch in one UPDATE: `escrow_deploy_status 'deploying' → 'deployed'` + record the
   * contract address + `status 'planned' → 'approved'`. Returns true iff this writer won. (Approvals are
   * soft-deleted by the processor via the approval repo in the SAME txn, not here.)
   */
  casEscrowDeployed(
    manager: EntityManager,
    id: string,
    latch: EscrowDeployedLatch,
  ): Promise<boolean>;

  /** CAS `escrow_deploy_status 'deploying' → 'failed'` (retryable). Returns true iff this writer won. */
  casEscrowFailed(manager: EntityManager, id: string): Promise<boolean>;

  /** CAS `status 'approved' → 'opened'`, guarded on `window_open_at <= now()`. Returns true iff won. */
  casOpened(manager: EntityManager, id: string): Promise<boolean>;

  // ── TOV-160 settlement CAS surface ──────────────────────────────────────────────────────────────────

  /**
   * CAS `status 'opened' → 'subscribed'`, guarded on a CLOSED bidding window (`window_close_at <= now()`).
   * The settle latch (mirrors `casEscrowDeploying`); returns true iff this writer won. `updatedAt` becomes
   * the staleness anchor for `findStaleSubscribed`.
   */
  casSubscribed(manager: EntityManager, id: string): Promise<boolean>;

  /**
   * CAS `status 'subscribed' → 'settled'` (terminal success), clearing any prior settle-failure stamp.
   * Returns true iff this writer won. The `offering_clearing_audit` insert + the `offering_bids` won/lost
   * flip ride in the SAME txn.
   */
  casSettled(manager: EntityManager, id: string): Promise<boolean>;

  /**
   * Set (reason != null, TERMINAL failure stamp) or clear (reason == null, admin re-drive reclaim) the
   * settle-failure signal on a `subscribed` row. The stamp leaves the offering `subscribed` (never partially
   * settled) and excludes it from the stale-subscribed reconcile; the reclaim additionally guards
   * `settle_failed_at IS NOT NULL` so it only touches a genuinely-failed row. Returns true iff a row matched.
   */
  setSettleFailureStamp(manager: EntityManager, id: string, reason: string | null): Promise<boolean>;

  /**
   * Rows wedged in `subscribed` past the grace window with NO failure stamp (the crash-between-commit-and-
   * enqueue window). Re-driven by the settle reconcile sweep (the worker is idempotent). Terminally-failed
   * rows are excluded.
   */
  findStaleSubscribed(graceMs: number, batch: number, manager?: EntityManager): Promise<Offering[]>;

  /** Freeze the money-routing attestation (`snapshot_artist_address`) at first approval. */
  setSnapshotArtistAddress(manager: EntityManager, id: string, addr: string): Promise<void>;

  /** `approved` offerings whose `window_open_at` is due, oldest first, capped at `batch` (open sweep). */
  findDueForOpen(batch: number, manager?: EntityManager): Promise<Offering[]>;
  /** Rows wedged in `deploying` past the grace window (no live job) — re-driven by the reconcile sweep. */
  findStaleDeploying(graceMs: number, batch: number, manager?: EntityManager): Promise<Offering[]>;

  /**
   * Paginated backoffice list: `status IN (statuses)`, optional `artworkId`, non-deleted, `createdAt DESC`.
   * Returns `[rows, total]`. Mirrors the TOV-240 `ArtworkRepository` admin-list finder.
   */
  listForBackoffice(opts: {
    statuses: readonly OfferingStatus[];
    artworkId?: string;
    page: number;
    limit: number;
  }): Promise<[Offering[], number]>;
}
