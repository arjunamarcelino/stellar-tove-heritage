import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { RfqsService } from './rfqs.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { RfqResponseDto } from './dto/rfq-response.dto';

/**
 * Authenticated public RFQ surface (TOV-172, FR-06.01), served at `api/v1/marketplace/rfqs` via
 * RouterModule. NOT `@Public()`, so the global AuthGuard runs and the collector is owner-scoped to the JWT
 * `sub`. Pure DB create — no on-chain leg.
 *
 * NB: the `marketplace/rfqs` base path is also used by `QuotesController` (sibling `PublicQuotesModule`) for
 * `POST :id/quotes` — no collision; the RFQ path tree is intentionally split across the two modules (TOV-175 #381).
 */
@ApiTags('Marketplace RFQs')
@ApiBearerAuth()
@Controller('marketplace/rfqs')
export class RfqsController {
  constructor(private readonly rfqsService: RfqsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create an RFQ on a fractionalized artwork' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateRfqDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<RfqResponseDto> {
    return this.rfqsService.create(userId, dto, idempotencyKey);
  }
}
