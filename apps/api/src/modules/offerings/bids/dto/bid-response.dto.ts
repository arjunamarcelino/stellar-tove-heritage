import { ApiProperty } from '@nestjs/swagger';
import { OfferingBid } from '@modules/offerings/entities/offering-bid.entity';
import type { OfferingBidStatus } from '@modules/offerings/constants/offering-bid-status.constant';

/**
 * The caller's bid resource (TOV-156 + TOV-158). `201` (submit) returns it `submitted`; `GET :id/bids/me`
 * (backed by `findMyLatestBid`) polls it through `escrowed` (with `chainBidId`/`escrowTxHash`), then — if the
 * bidder cancels — `canceling → canceled` (with `refundTxHash`/`canceledAt`), or the terminals `failed`.
 * Money stays a string; the entity is never exposed directly. NB: `count` is a `numeric(39,0)` string.
 */
export class BidResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() offeringId!: string;
  @ApiProperty({ type: String, description: 'Bid price per fraction in stroops' }) price!: string;
  @ApiProperty({ type: String, description: 'Fraction count' }) count!: string;
  @ApiProperty({ type: String, description: 'Escrowed total = price × count (stroops)' })
  escrowAmountStroops!: string;
  @ApiProperty({ description: 'submitted | escrowed | failed | canceling | canceled' })
  status!: OfferingBidStatus;
  @ApiProperty({ nullable: true, description: 'Contract-returned 1-based bid id (once escrowed)' })
  chainBidId!: number | null;
  @ApiProperty({ nullable: true, description: 'On-chain submit_bid tx hash (once escrowed)' })
  escrowTxHash!: string | null;
  @ApiProperty({ nullable: true, description: 'On-chain cancel_bid refund tx hash (once canceled)' })
  refundTxHash!: string | null;
  @ApiProperty({ nullable: true, description: 'When the refund confirmed (ISO, once canceled)' })
  canceledAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromEntity(bid: OfferingBid): BidResponseDto {
    const dto = new BidResponseDto();
    dto.id = bid.id;
    dto.offeringId = bid.offeringId;
    dto.price = bid.priceStroops;
    dto.count = bid.count;
    dto.escrowAmountStroops = bid.escrowAmountStroops;
    dto.status = bid.status;
    dto.chainBidId = bid.chainBidId;
    dto.escrowTxHash = bid.escrowTxHash;
    dto.refundTxHash = bid.refundTxHash;
    dto.canceledAt = bid.canceledAt?.toISOString() ?? null;
    dto.createdAt = bid.createdAt.toISOString();
    dto.updatedAt = bid.updatedAt.toISOString();
    return dto;
  }
}
