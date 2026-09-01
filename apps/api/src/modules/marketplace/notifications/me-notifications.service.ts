import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { failHttp } from '@common/http/fail-http';
import { ErrorCode } from '@common/enums/error-code.enum';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import {
  RFQ_NOTIFICATION_REPOSITORY,
  IRfqNotificationRepository,
} from './repositories/rfq-notification-repository.interface';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

/** Unread-count probe ceiling: render `count >= UNREAD_COUNT_CAP` as e.g. "99+" client-side. */
const UNREAD_COUNT_CAP = 100;

/**
 * Owner-scoped RFQ notifications inbox (TOV-174). Every read/mutation is scoped to the JWT `sub`; a foreign
 * or missing notification returns an identical 404 (no existence oracle — mirrors `collectors/`). Not
 * whitelist-gated (a frozen holder keeps access to their own records — TOV-158 precedent).
 */
@Injectable()
export class MeNotificationsService {
  constructor(
    @Inject(RFQ_NOTIFICATION_REPOSITORY) private readonly notifications: IRfqNotificationRepository,
  ) {}

  async list(
    recipientSub: string,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    const [rows, total] = await this.notifications.listForRecipient(recipientSub, {
      page: query.page,
      limit: query.limit,
      unread: query.filter === 'unread',
    });
    return PaginatedResponseDto.create(
      rows.map((row) => NotificationResponseDto.fromRow(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async unreadCount(recipientSub: string): Promise<UnreadCountResponseDto> {
    return { count: await this.notifications.countUnreadForRecipient(recipientSub, UNREAD_COUNT_CAP) };
  }

  async markRead(recipientSub: string, id: string): Promise<NotificationResponseDto> {
    // Flip if unread (no-op if already-read); then read the current joined row. Absent/not-owned → 404.
    await this.notifications.markRead(id, recipientSub);
    const row = await this.notifications.findRowById(id, recipientSub);
    if (!row) {
      throw failHttp(ErrorCode.NOTIFICATION_NOT_FOUND, HttpStatus.NOT_FOUND, 'Notification not found');
    }
    return NotificationResponseDto.fromRow(row);
  }
}
