import { ApiProperty } from '@nestjs/swagger';
import { Offering } from '@modules/offerings/entities/offering.entity';
import {
  OFFERING_STATUSES,
  OfferingStatus,
} from '@modules/offerings/constants/offering-status.constant';

/**
 * 201 body for the plan-offering request (TOV-152). Never exposes the entity. The three `numeric`→`string`
 * money fields pass through UNTOUCHED (never coerced to `number` — precision loss above 2^53); the three
 * `Date` fields are `.toISOString()`'d to canonical UTC (the declared type is `string`).
 */
export class OfferingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() artworkId!: string;
  /** The deployed fraction_contract the public float was snapshotted from (float provenance; todo 263). */
  @ApiProperty() fractionContractId!: string;
  @ApiProperty({ enum: OFFERING_STATUSES }) status!: OfferingStatus;
  @ApiProperty() lowPriceStroops!: string;
  @ApiProperty() highPriceStroops!: string;
  @ApiProperty() publicFloat!: string;
  @ApiProperty() windowOpenAt!: string;
  @ApiProperty() windowCloseAt!: string;
  @ApiProperty() createdAt!: string;

  static fromEntity(o: Offering): OfferingResponseDto {
    const dto = new OfferingResponseDto();
    dto.id = o.id;
    dto.artworkId = o.artworkId;
    dto.fractionContractId = o.fractionContractId;
    dto.status = o.status;
    dto.lowPriceStroops = o.lowPriceStroops;
    dto.highPriceStroops = o.highPriceStroops;
    dto.publicFloat = o.publicFloat;
    dto.windowOpenAt = o.windowOpenAt.toISOString();
    dto.windowCloseAt = o.windowCloseAt.toISOString();
    dto.createdAt = o.createdAt.toISOString();
    return dto;
  }
}
