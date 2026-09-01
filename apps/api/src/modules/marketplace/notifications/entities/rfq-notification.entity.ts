import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import type { RfqNotificationChannel } from '../constants/rfq-notification.constants';

/**
 * One in-app notification row per (RFQ, recipient) — the durable inbox behind `GET /me/notifications`
 * (TOV-174, FR-06.02). Written by the `rfq-fanout` worker for every current holder of the RFQ's artwork's
 * fractions (settled primary-offering winners), excluding the RFQ issuer.
 *
 * Under `synchronize:false` migration `1716000000042` is authoritative for: the FULL unique dedup belt
 * `UQ_rfq_notifications_recipient_channel (rfq_id, recipient_sub, channel)` (so an idempotent re-run's
 * `ON CONFLICT DO NOTHING` finds an arbiter), the `CHK_notif_channel` belt, the `rfq_id → rfqs(id) ON
 * DELETE RESTRICT` FK, and the immutability guard (`fn_rfq_notifications_guard` blocks delete/soft-delete
 * and freezes the identity columns; `read_at` is intentionally NOT frozen so a future mark-unread needs no
 * guard migration). `recipient_sub`/`artwork_id` carry NO FK (audit-actor semantics; a soft-deleted-winner
 * must still get a row).
 */
@Entity({ name: 'rfq_notifications' })
export class RfqNotification extends BaseEntity {
  /** The RFQ this notifies about. FK → rfqs(id) (RFQ deletes are blocked by fn_rfqs_guard, so it's safe). */
  @Column({ name: 'rfq_id', type: 'uuid' })
  rfqId!: string;

  /** The recipient holder's verified JWT `sub` (a users.id). No FK — audit-actor semantics, mirrors rfqs.collector_sub. */
  @Column({ name: 'recipient_sub', type: 'uuid' })
  recipientSub!: string;

  /** Copied from the RFQ at fan-out time. Immutable; a stable filter seam (not a mutable snapshot). */
  @Column({ name: 'artwork_id', type: 'uuid' })
  artworkId!: string;

  /** Delivery channel; only `in_app` today. Email is a future discriminated-union seam. */
  @Column({ name: 'channel', type: 'varchar', length: 16, default: 'in_app' })
  channel!: RfqNotificationChannel;

  /** NULL = unread. App-level set-once via `markRead` (`WHERE read_at IS NULL`); not DB-frozen. */
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;
}
