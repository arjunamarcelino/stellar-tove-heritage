import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';

// NB: shares the `marketplace/rfqs` base path with `RfqsController` (in the sibling `PublicRfqsModule`) —
// no route collision (`POST /marketplace/rfqs` there vs `POST /marketplace/rfqs/:id/quotes` here). This
// mirrors the offering-bids precedent (bids own a sub-path under `offerings`). See TOV-175 #381.
@ApiTags('Marketplace Quotes')
@ApiBearerAuth()
@Controller('marketplace/rfqs')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post(':id/quotes')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Submit a quote (offer to sell) on an open RFQ' })
  submit(
    @Param('id', new ParseUUIDPipe()) rfqId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateQuoteDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<QuoteResponseDto> {
    return this.quotesService.submit(userId, rfqId, dto, idempotencyKey);
  }
}
