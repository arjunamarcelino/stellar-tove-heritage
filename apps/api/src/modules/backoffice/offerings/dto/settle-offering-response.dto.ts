import { ApiProperty } from '@nestjs/swagger';
import { Offering } from '@modules/offerings/entities/offering.entity';
import { OFFERING_STATUSES, OfferingStatus } from '@modules/offerings/constants/offering-status.constant';

/**
 * 202 body for `POST /offerings/:id/settle` (TOV-160). The settlement runs async; the offering is latched
 * `subscribed` and the client polls `GET /offerings/:id` for `settled` (or a `settleFailedAt`/reason if a
 * terminal failure needs an admin re-drive).
 */
export class SettleOfferingResponseDto {
  @ApiProperty() offeringId!: string;
  @ApiProperty({ enum: OFFERING_STATUSES }) status!: OfferingStatus;
  @ApiProperty({ description: 'The uniform clearing price the worker will settle at (server-computed).' })
  clearingPriceStroops!: string;
  @ApiProperty({ description: 'Number of winning bids at the computed clearing.' }) winners!: number;

  static build(o: Offering, clearingPriceStroops: string, winners: number): SettleOfferingResponseDto {
    const dto = new SettleOfferingResponseDto();
    dto.offeringId = o.id;
    dto.status = o.status;
    dto.clearingPriceStroops = clearingPriceStroops;
    dto.winners = winners;
    return dto;
  }
}
