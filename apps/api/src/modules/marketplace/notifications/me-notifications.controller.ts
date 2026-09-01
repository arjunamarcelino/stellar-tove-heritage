import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiPaginatedResponse } from '@common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { MeNotificationsService } from './me-notifications.service';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

/**
 * Authenticated, owner-scoped RFQ notifications inbox (TOV-174), at `api/v1/me/notifications`. NOT
 * `@Public()` — the global AuthGuard runs; the recipient is the JWT `sub` (no user/id param → IDOR-closed).
 * Throttled per identity (60/min). Since there is no real-time push yet, the FE polls these endpoints.
 */
@ApiTags('me-notifications')
@ApiBearerAuth()
@Controller('me/notifications')
@Throttle({ default: { ttl: 60000, limit: 60 } })
export class MeNotificationsController {
  constructor(private readonly notifications: MeNotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's RFQ notifications (newest-first, paginated)" })
  @ApiPaginatedResponse(NotificationResponseDto)
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    return this.notifications.list(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: "The caller's unread notification count (capped at 100 → render '99+')" })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  unreadCount(@CurrentUser('sub') userId: string): Promise<UnreadCountResponseDto> {
    return this.notifications.unreadCount(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification read (set-once idempotent)' })
  @ApiOkResponse({ type: NotificationResponseDto })
  markRead(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponseDto> {
    return this.notifications.markRead(userId, id);
  }
}
