import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { HandleService } from './handle.service';
import { SetHandleDto } from './dto/set-handle.dto';
import { SetHandleResponseDto } from './dto/set-handle-response.dto';
import { MyHandleResponseDto } from './dto/my-handle-response.dto';
import { SetHandleHistoryVisibilityDto } from './dto/set-handle-history-visibility.dto';

/**
 * Authenticated, owner-scoped `me/handle` surface (TOV-26), served at `api/v1/me/handle`. NOT
 * `@Public()` — the global AuthGuard runs and both routes are scoped to the JWT `sub`. Set is a freely
 * changeable upsert (200); the DB unique index enforces global case-insensitive uniqueness.
 */
@ApiTags('me-handle')
@ApiBearerAuth()
@Controller('me/handle')
export class MeHandleController {
  constructor(private readonly handleService: HandleService) {}

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: "Read the caller's current handle (null if unset)" })
  getMine(@CurrentUser('sub') userId: string): Promise<MyHandleResponseDto> {
    return this.handleService.getMyHandle(userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Set/change the caller handle (409 if taken, 422 if invalid/reserved)' })
  set(@CurrentUser('sub') userId: string, @Body() dto: SetHandleDto): Promise<SetHandleResponseDto> {
    return this.handleService.setHandle(userId, dto.handle);
  }

  @Patch('history')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Show/hide handle history on the public collector profile (TOV-27)' })
  setHistoryVisibility(
    @CurrentUser('sub') userId: string,
    @Body() dto: SetHandleHistoryVisibilityDto,
  ): Promise<SetHandleHistoryVisibilityDto> {
    return this.handleService.setHistoryVisibility(userId, dto.public);
  }
}
