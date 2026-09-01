import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import {
  NOTIFICATION_FILTERS,
  NotificationFilter,
} from '../constants/rfq-notification.constants';

/**
 * Inbox query for `GET /me/notifications` (TOV-174). Extends the shared page/limit pagination. `filter` is an
 * explicit enum (NOT a boolean whose `false` ambiguously means "all") — omitted or `all` returns everything,
 * `unread` returns only `read_at IS NULL`. The allowed values derive from the single `NOTIFICATION_FILTERS`
 * tuple-const so the Swagger enum, the validator, and the type can't drift.
 */
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(NOTIFICATION_FILTERS)
  filter?: NotificationFilter;
}
