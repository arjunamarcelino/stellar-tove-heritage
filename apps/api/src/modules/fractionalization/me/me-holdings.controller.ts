import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { HoldingDto } from './dto/holding.dto';
import { MeHoldingsService } from './me-holdings.service';

/**
 * Authenticated, owner-scoped `me/holdings` surface, served at `api/v1/me/holdings` (TOV-237). NOT
 * `@Public()` — the global AuthGuard runs and the caller's wallet is resolved from the JWT `sub`; no
 * wallet/user param is accepted (IDOR-closed by construction). Throttled per identity; the 30s cache caps
 * real RPC fan-out to ~2/min per user.
 */
@ApiTags('me-holdings')
@ApiBearerAuth()
@Controller('me/holdings')
export class MeHoldingsController {
  constructor(private readonly holdingsService: MeHoldingsService) {}

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: "List the caller's fraction holdings across all fractionalized artworks",
  })
  @ApiOkResponse({ type: HoldingDto, isArray: true })
  list(@CurrentUser('sub') userId: string): Promise<HoldingDto[]> {
    return this.holdingsService.listHoldings(userId);
  }
}
