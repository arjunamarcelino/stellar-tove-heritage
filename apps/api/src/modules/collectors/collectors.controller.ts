import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { CollectorsService } from './collectors.service';
import { CollectorProfileResponseDto } from './dto/collector-profile-response.dto';

/**
 * Public collector profile (TOV-27, FR-01.06), served at `api/v1/collectors/:handle`. `@Public()` — no JWT.
 * The global UserAwareThrottlerGuard keys anonymous requests by IP; the explicit `@Throttle` overrides the
 * loose global default on this enumerable surface (mirrors `GET /handles/check`). Resolves the CURRENT
 * handle only, case-insensitively; old / unknown / soft-deleted handles all return an identical 404.
 */
@ApiTags('collectors')
@Public()
@Controller('collectors')
export class CollectorsController {
  constructor(private readonly collectorsService: CollectorsService) {}

  @Get(':handle')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Get a public collector profile by current handle (404 on old/unknown handles)' })
  getProfile(@Param('handle') handle: string): Promise<CollectorProfileResponseDto> {
    return this.collectorsService.getProfile(handle);
  }
}
