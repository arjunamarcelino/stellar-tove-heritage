import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { OfferingBidsService } from './offering-bids.service';
import { PrepareBidDto } from './dto/prepare-bid.dto';
import { PrepareBidResponseDto } from './dto/prepare-bid-response.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { BidResponseDto } from './dto/bid-response.dto';
import { CancelBidDto } from './dto/cancel-bid.dto';
import { PrepareCancelBidResponseDto } from './dto/prepare-cancel-bid-response.dto';

/**
 * Authenticated public bid surface (TOV-156, FR-05.03), served at `api/v1/offerings/:id/bids...` via
 * RouterModule. NOT `@Public()`, so the global AuthGuard runs and the bidder is owner-scoped to the JWT
 * `sub`. `/prepare` is throttled tighter (the only unpriced Soroban `simulate`); the whole surface is a
 * money surface. Static `/bids/prepare` + `/bids/me` are declared before the `/bids` POST — no `:param`
 * ordering hazard since all bid routes share the `:id/bids` prefix.
 */
@ApiTags('Offering Bids')
@ApiBearerAuth()
@Controller('offerings')
export class OfferingBidsController {
  constructor(private readonly bidsService: OfferingBidsService) {}

  @Post(':id/bids/prepare')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Validate a bid + build the unsigned submit_bid and the passkey challenge' })
  prepare(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) offeringId: string,
    @Body() dto: PrepareBidDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<PrepareBidResponseDto> {
    return this.bidsService.prepare(userId, offeringId, dto, idempotencyKey);
  }

  @Post(':id/bids')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Submit a prepared bid with the passkey assertion; escrows asynchronously' })
  submit(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) offeringId: string,
    @Body() dto: SubmitBidDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<BidResponseDto> {
    return this.bidsService.submit(userId, offeringId, dto, idempotencyKey);
  }

  @Get(':id/bids/me')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: "The caller's latest bid on this offering (poll for escrowed/canceled/failed)" })
  getMyBid(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) offeringId: string,
  ): Promise<BidResponseDto | null> {
    return this.bidsService.getMyBid(userId, offeringId);
  }

  @Post(':id/bids/cancel/prepare')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Build the unsigned cancel_bid + the passkey challenge for the active bid' })
  prepareCancel(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) offeringId: string,
  ): Promise<PrepareCancelBidResponseDto> {
    // No Idempotency-Key: cancel_bid takes no on-chain idem arg, so prepare is a pure (non-replay) builder.
    return this.bidsService.prepareCancel(userId, offeringId);
  }

  @Post(':id/bids/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Cancel a bid with the passkey assertion; refunds USDC asynchronously (202)' })
  cancel(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) offeringId: string,
    @Body() dto: CancelBidDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<BidResponseDto> {
    return this.bidsService.cancel(userId, offeringId, dto, idempotencyKey);
  }
}
