import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { AcceptService } from './accept.service';
import { AcceptDto, AcceptPrepareDto } from './dto/accept.dto';
import { AcceptPrepareResponseDto, AcceptResponseDto, TradeResponseDto } from './dto/accept-response.dto';

// Buyer-accept + atomic-settlement surface (TOV-177, FR-06.04+06.05). Shares the `marketplace/rfqs` base path.
@ApiTags('Marketplace Accept')
@ApiBearerAuth()
@Controller('marketplace/rfqs')
export class AcceptController {
  constructor(private readonly service: AcceptService) {}

  @Post(':id/accept/prepare')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Build the buyer accept challenge for a chosen quote' })
  @ApiOkResponse({ type: AcceptPrepareResponseDto })
  prepare(
    @Param('id', new ParseUUIDPipe()) rfqId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: AcceptPrepareDto,
  ): Promise<AcceptPrepareResponseDto> {
    return this.service.prepare(userId, rfqId, dto);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Submit a signed accept — records a pending trade + settles asynchronously' })
  @ApiOkResponse({ type: AcceptResponseDto })
  accept(
    @Param('id', new ParseUUIDPipe()) rfqId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: AcceptDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<AcceptResponseDto> {
    return this.service.accept(userId, rfqId, dto, idempotencyKey);
  }

  @Get(':id/accept/me')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "Poll the caller's latest trade on this RFQ" })
  @ApiOkResponse({ type: TradeResponseDto })
  getMe(
    @Param('id', new ParseUUIDPipe()) rfqId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<TradeResponseDto> {
    return this.service.getMe(userId, rfqId);
  }
}
