import { ApiProperty } from '@nestjs/swagger';
import { Offering } from '@modules/offerings/entities/offering.entity';
import { ClearingResult } from '@modules/offerings/clearing';

/**
 * One winning bid in the clearing preview. Per-collector identity is REDACTED (only the on-chain `bidId` +
 * amounts) — the preview is a money-review surface, not a bidder-directory, and this keeps the sealed-auction
 * book from being enumerable even to an admin.
 */
export class ClearingAllocationItemDto {
  @ApiProperty({ description: 'On-chain bid id (u32)' }) bidId!: number;
  @ApiProperty() priceStroops!: string;
  @ApiProperty({ description: 'Fractions this bid clears' }) allocatedCount!: string;
  @ApiProperty({ description: 'USDC returned to this winner (escrow − P·allocated)' }) refundStroops!: string;
}

/**
 * Read-only dry-run of the uniform-price clearing (TOV-160) — computed from the CURRENT book WITHOUT
 * settling, so an admin can review P + allocations + proceeds before triggering the irreversible settlement.
 * When undersubscribed (`fullySubscribed:false`) the clearing price is `null` and `allocations` is empty
 * (settlement would be refused).
 */
export class ClearingPreviewDto {
  @ApiProperty() offeringId!: string;
  @ApiProperty({ description: 'Σ escrowed count == public_float exactly (a settleable book)' })
  fullySubscribed!: boolean;
  @ApiProperty({ nullable: true, description: 'The uniform price P every winner pays; null if undersubscribed' })
  clearingPriceStroops!: string | null;
  @ApiProperty() publicFloat!: string;
  @ApiProperty({ description: 'Σ escrowed count' }) totalDemand!: string;
  @ApiProperty() proceedsStroops!: string;
  @ApiProperty({ description: 'floor(proceeds·3%)' }) platformFeeStroops!: string;
  @ApiProperty({ description: 'proceeds − platform fee' }) artistNetStroops!: string;
  @ApiProperty({ type: [ClearingAllocationItemDto] }) allocations!: ClearingAllocationItemDto[];

  static build(offering: Offering, result: ClearingResult): ClearingPreviewDto {
    const dto = new ClearingPreviewDto();
    dto.offeringId = offering.id;
    dto.fullySubscribed = result.fullySubscribed;
    dto.clearingPriceStroops = result.clearingPriceStroops;
    dto.publicFloat = offering.publicFloat;
    dto.totalDemand = result.totalDemand;
    dto.proceedsStroops = result.proceedsStroops;
    dto.platformFeeStroops = result.platformFeeStroops;
    dto.artistNetStroops = result.artistNetStroops;
    dto.allocations = result.winners.map((w) => ({
      bidId: w.chainBidId,
      priceStroops: w.priceStroops,
      allocatedCount: w.allocatedCount,
      refundStroops: w.refundStroops,
    }));
    return dto;
  }
}
