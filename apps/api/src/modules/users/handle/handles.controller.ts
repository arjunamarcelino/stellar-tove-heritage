import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { HandleService } from './handle.service';
import { CheckHandleQueryDto } from './dto/check-handle-query.dto';
import { CheckHandleResponseDto } from './dto/check-handle-response.dto';

/**
 * Public handle availability check (TOV-26), served at `api/v1/handles/check`. `@Public()` — no JWT,
 * so it supports pre-signup checks; the global UserAwareThrottlerGuard keys anonymous requests by IP.
 * The explicit `@Throttle` overrides the loose global default (100/60s) on this enumeration surface.
 * Always 200: invalid/reserved/taken return `available:false` + a reason (never 422).
 */
@ApiTags('handles')
@Public()
@Controller('handles')
export class HandlesController {
  constructor(private readonly handleService: HandleService) {}

  @Get('check')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Check handle availability (public, IP rate-limited)' })
  check(@Query() query: CheckHandleQueryDto): Promise<CheckHandleResponseDto> {
    return this.handleService.check(query.handle);
  }
}
