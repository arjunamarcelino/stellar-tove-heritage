import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import type { RfqStatus } from '@modules/marketplace/rfqs/constants/rfq-status.constant';
import { RfqNotification } from '../entities/rfq-notification.entity';
import { NewRfqNotification } from '../constants/rfq-notification.constants';

export const RFQ_NOTIFICATION_REPOSITORY = 'IRfqNotificationRepository';

/**
 * Fully-resolved inbox row: the notification joined to its RFQ (live status/terms) + artwork (display).
 * `artworkSlug` is derived in the DTO (no column). Money fields are canonical decimal strings.
 */
export interface NotificationRow {
  id: string;
  rfqId: string;
  artworkId: string;
  artworkTitle: string;
  artworkImageUrl: string | null;
  fractionCount: string;
  maxPricePerFractionStroops: string;
  rfqStatus: RfqStatus;
  rfqExpiresAt: Date;
  readAt: Date | null;
  createdAt: Date;
}

/** Owner-scoped inbox query options. `unread=true` filters to `read_at IS NULL`. */
export interface ListNotificationsOptions {
  page: number;
  limit: number;
  unread: boolean;
}

/**
 * RFQ-notifications inbox port (TOV-174). `insertManyIgnoreConflicts` takes an `EntityManager` so the
 * chunk-free UNNEST insert composes inside the fan-out `runInTransaction` alongside the latch + audit.
 */
export interface IRfqNotificationRepository extends IBaseRepository<RfqNotification> {
  /**
   * Bulk-insert one row per recipient via a single UNNEST statement (one array param per column — sidesteps
   * the 65535 bind-param limit; no chunking). `ON CONFLICT ("rfq_id","recipient_sub","channel") DO NOTHING`
   * against the FULL unique index makes a re-run (retry / reconcile) a no-op. No return — the caller derives
   * the recipient count separately (a `RETURNING` would ship M ids back purely to be discarded).
   */
  insertManyIgnoreConflicts(manager: EntityManager, rows: NewRfqNotification[]): Promise<void>;

  /**
   * Count of notification rows for an RFQ, within the caller's txn (TOV-174). Used by the fan-out winner to
   * stamp an EXACT `recipientCount` on the audit row — the actual rows that exist, not the resolving worker's
   * pre-txn `winnerSubs.length` (which could under-count if a concurrent worker inserted a divergent set).
   */
  countForRfq(manager: EntityManager, rfqId: string): Promise<number>;

  /** Owner-scoped inbox page (newest-first, single JOIN to rfqs+artworks). `[rows, total]`. */
  listForRecipient(recipientSub: string, opts: ListNotificationsOptions): Promise<[NotificationRow[], number]>;

  /** Bounded unread count for a badge — `SELECT count(*) FROM (… LIMIT :cap)` so a never-reader can't scan unbounded. */
  countUnreadForRecipient(recipientSub: string, cap: number): Promise<number>;

  /**
   * Set-once mark-read: `UPDATE … WHERE id AND recipient_sub AND read_at IS NULL`. Returns true iff it
   * flipped an unread owned row; false when already-read OR not-owned OR missing (a second PATCH no-ops).
   */
  markRead(id: string, recipientSub: string): Promise<boolean>;

  /** Owner-scoped single joined row (same shape as the list; for the PATCH response). `null` if not-owned/missing. */
  findRowById(id: string, recipientSub: string): Promise<NotificationRow | null>;
}
