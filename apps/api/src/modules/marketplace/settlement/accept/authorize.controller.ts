import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { AuthorizeService } from './authorize.service';
import { AuthorizeQuoteDto } from './dto/authorize.dto';
import { AuthorizePrepareResponseDto } from './dto/authorize-prepare-response.dto';
import { AuthorizeResponseDto } from './dto/authorize-response.dto';

// Seller-authorize surface (TOV-177, FR-06.04). Shares the `marketplace/rfqs` base path — no route collision
// (`:rfqId/quotes/:quoteId/authorize*` is unique). The seller pre-signs their quote so a buyer can accept it.
@ApiTags('Marketplace Quote Authorization')
@ApiBearerAuth()
@Controller('marketplace/rfqs')
export class AuthorizeController {
  constructor(private readonly service: AuthorizeService) {}

  @Post(':rfqId/quotes/:quoteId/authorize/prepare')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Build the seller authorization challenge for a quote' })
  @ApiOkResponse({ type: AuthorizePrepareResponseDto })
  prepare(
    @Param('rfqId', new ParseUUIDPipe()) rfqId: string,
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<AuthorizePrepareResponseDto> {
    return this.service.prepare(userId, rfqId, quoteId);
  }

  @Post(':rfqId/quotes/:quoteId/authorize')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Store the signed seller authorization on a quote (makes it acceptable)' })
  @ApiOkResponse({ type: AuthorizeResponseDto })
  authorize(
    @Param('rfqId', new ParseUUIDPipe()) rfqId: string,
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: AuthorizeQuoteDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<AuthorizeResponseDto> {
    return this.service.authorize(userId, rfqId, quoteId, dto, idempotencyKey);
  }
}
