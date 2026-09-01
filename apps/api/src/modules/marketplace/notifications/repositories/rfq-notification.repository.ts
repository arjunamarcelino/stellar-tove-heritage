import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import type { RfqStatus } from '@modules/marketplace/rfqs/constants/rfq-status.constant';
import { RfqNotification } from '../entities/rfq-notification.entity';
import { NewRfqNotification } from '../constants/rfq-notification.constants';
import {
  IRfqNotificationRepository,
  ListNotificationsOptions,
  NotificationRow,
} from './rfq-notification-repository.interface';

/** Raw row shape from the inbox JOIN (snake_case aliases → mapped to {@link NotificationRow}). */
interface RawInboxRow {
  id: string;
  rfq_id: string;
  artwork_id: string;
  artwork_title: string;
  artwork_image_url: string | null;
  fraction_count: string;
  max_price_per_fraction_stroops: string;
  rfq_status: RfqStatus;
  rfq_expires_at: Date;
  read_at: Date | null;
  created_at: Date;
}

@Injectable()
export class RfqNotificationRepository
  extends BaseRepository<RfqNotification>
  implements IRfqNotificationRepository
{
  constructor(dataSource: DataSource) {
    super(RfqNotification, dataSource);
  }

  async insertManyIgnoreConflicts(manager: EntityManager, rows: NewRfqNotification[]): Promise<void> {
    if (rows.length === 0) return;
    // Single UNNEST insert: one array param per column (total params = 3, independent of row count), so it
    // sidesteps the 65535 bind-param limit with no chunk loop. channel defaults to 'in_app'. The bare
    // ON CONFLICT target is served by the FULL unique index UQ_rfq_notifications_recipient_channel. No
    // RETURNING — the caller derives the recipient count elsewhere, so shipping M ids back would be waste.
    await manager.query(
      `INSERT INTO "rfq_notifications" ("rfq_id", "recipient_sub", "artwork_id")
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[])
       ON CONFLICT ("rfq_id", "recipient_sub", "channel") DO NOTHING`,
      [rows.map((r) => r.rfqId), rows.map((r) => r.recipientSub), rows.map((r) => r.artworkId)],
    );
  }

  /**
   * Shared inbox JOIN: notification → rfqs (live status/terms) → artworks (display). Owner-scoped. Table-name
   * joins keep the neutral repo decoupled from the rfqs/artworks entity classes.
   */
  private inboxQuery(recipientSub: string) {
    return this.repository
      .createQueryBuilder('n')
      .innerJoin('rfqs', 'r', 'r.id = n.rfq_id')
      // Deliberately NOT filtered on `a.deleted_at` (todo 368): a holder still sees the notification for an
      // artwork they hold even if it was later soft-deleted; it's not a leak (they're a legitimate holder).
      .innerJoin('artworks', 'a', 'a.id = n.artwork_id')
      .where('n.recipient_sub = :recipientSub', { recipientSub })
      .andWhere('n.deleted_at IS NULL')
      .select('n.id', 'id')
      .addSelect('n.rfq_id', 'rfq_id')
      .addSelect('n.artwork_id', 'artwork_id')
      .addSelect('a.title', 'artwork_title')
      .addSelect('a.primary_image_url', 'artwork_image_url')
      .addSelect('r.fraction_count', 'fraction_count')
      .addSelect('r.max_price_per_fraction_stroops', 'max_price_per_fraction_stroops')
      .addSelect('r.status', 'rfq_status')
      .addSelect('r.expires_at', 'rfq_expires_at')
      .addSelect('n.read_at', 'read_at')
      .addSelect('n.created_at', 'created_at');
  }

  private static toRow(row: RawInboxRow): NotificationRow {
    return {
      id: row.id,
      rfqId: row.rfq_id,
      artworkId: row.artwork_id,
      artworkTitle: row.artwork_title,
      artworkImageUrl: row.artwork_image_url,
      fractionCount: row.fraction_count,
      maxPricePerFractionStroops: row.max_price_per_fraction_stroops,
      rfqStatus: row.rfq_status,
      rfqExpiresAt: row.rfq_expires_at,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }

  async countForRfq(manager: EntityManager, rfqId: string): Promise<number> {
    const rows: Array<{ count: number }> = await manager.query(
      `SELECT count(*)::int AS count FROM "rfq_notifications" WHERE "rfq_id" = $1::uuid AND "deleted_at" IS NULL`,
      [rfqId],
    );
    return rows[0]?.count ?? 0;
  }

  async listForRecipient(
    recipientSub: string,
    opts: ListNotificationsOptions,
  ): Promise<[NotificationRow[], number]> {
    // Count is JOIN-FREE: every predicate is on `n.` alone, so the rfqs/artworks joins (1:1 to PK) would be
    // pure nested-loop overhead on every page. This is an index-only count on IDX_rfq_notifications_inbox/_unread.
    const countQb = this.repository
      .createQueryBuilder('n')
      .where('n.recipient_sub = :recipientSub', { recipientSub })
      .andWhere('n.deleted_at IS NULL');
    if (opts.unread) countQb.andWhere('n.read_at IS NULL');
    const total = await countQb.getCount();

    // Page: the display JOIN, newest-first with the id tiebreak (served by IDX_rfq_notifications_inbox/_unread).
    // Offset pagination is acceptable for an inbox (limit<=100, users rarely deep-paginate); the (created_at,id)
    // index is keyset-ready, so cut over to keyset (WHERE (created_at,id) < :cursor) if inbox depth grows large.
    const q = this.inboxQuery(recipientSub);
    if (opts.unread) q.andWhere('n.read_at IS NULL');
    const raw = await q
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .offset((opts.page - 1) * opts.limit)
      .limit(opts.limit)
      .getRawMany<RawInboxRow>();
    return [raw.map((row) => RfqNotificationRepository.toRow(row)), total];
  }

  async findRowById(id: string, recipientSub: string): Promise<NotificationRow | null> {
    const raw = await this.inboxQuery(recipientSub).andWhere('n.id = :id', { id }).getRawOne<RawInboxRow>();
    return raw ? RfqNotificationRepository.toRow(raw) : null;
  }

  async countUnreadForRecipient(recipientSub: string, cap: number): Promise<number> {
    // Bounded probe: a never-reader can accrue unbounded unread rows, so cap the scan at `cap` and render
    // "cap+" (e.g. "99+"). Served by IDX_rfq_notifications_unread.
    // `count(*)::int` → int4, which node-postgres deserializes to a JS number (only int8/bigint returns a string).
    const rows: Array<{ count: number }> = await this.repository.query(
      // Explicit `$1::uuid` cast (not implicit text→uuid coercion) so the intent is clear; a non-UUID `sub`
      // (never happens for a real user id) fails the cast explicitly rather than via silent coercion.
      `SELECT count(*)::int AS count FROM (
         SELECT 1 FROM "rfq_notifications"
          WHERE "recipient_sub" = $1::uuid AND "read_at" IS NULL AND "deleted_at" IS NULL
          LIMIT $2
       ) t`,
      [recipientSub, cap],
    );
    return rows[0]?.count ?? 0;
  }

  async markRead(id: string, recipientSub: string): Promise<boolean> {
    // Set-once: only flips an unread, owned row. 0 rows = already-read OR not-owned OR missing (a second
    // PATCH no-ops). The service reads the current joined row afterward (200 either way, or 404 if absent).
    const result = await this.repository
      .createQueryBuilder()
      .update(RfqNotification)
      .set({ readAt: () => 'now()', updatedAt: () => 'now()' })
      .where('id = :id AND recipient_sub = :recipientSub AND read_at IS NULL', { id, recipientSub })
      .execute();
    return (result.affected ?? 0) === 1;
  }
}
