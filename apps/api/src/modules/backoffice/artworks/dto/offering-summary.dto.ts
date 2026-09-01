import { ApiProperty } from '@nestjs/swagger';
import { Offering } from '@modules/offerings/entities/offering.entity';
import {
  ACTIVE_OFFERING_STATUSES,
  OfferingStatus,
} from '@modules/offerings/constants/offering-status.constant';

/**
 * The single active (non-terminal) offering embedded on the admin artwork detail (TOV-153) — the UI gates
 * the "Plan Offering" CTA on this being `null`. Fields are the offering's OWN persisted band/window/snapshot
 * (NOT a preview's hypothetical band). `publicFloat` is the plan-time snapshot; `createdByAdminSub` is
 * intentionally omitted (not needed by the CTA gate). Money values are strings; windows are `NOT NULL`.
 */
export class OfferingSummaryDto {
  @ApiProperty()
  id!: string;

  // enum advertises only the non-terminal set — an activeOffering can never be settled/canceled.
  // The TS type stays the wider OfferingStatus (the entity column is wider).
  @ApiProperty({ enum: ACTIVE_OFFERING_STATUSES })
  status!: OfferingStatus;

  @ApiProperty({ type: 'string', example: '50000000' })
  lowPriceStroops!: string;

  @ApiProperty({ type: 'string', example: '150000000' })
  highPriceStroops!: string;

  @ApiProperty({ type: 'string', example: '900000', description: 'plan-time public-float snapshot' })
  publicFloat!: string;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  windowOpenAt!: string;

  @ApiProperty({ example: '2026-09-08T00:00:00.000Z' })
  windowCloseAt!: string;

  static fromEntity(o: Offering): OfferingSummaryDto {
    const dto = new OfferingSummaryDto();
    dto.id = o.id;
    dto.status = o.status;
    dto.lowPriceStroops = o.lowPriceStroops;
    dto.highPriceStroops = o.highPriceStroops;
    dto.publicFloat = o.publicFloat;
    dto.windowOpenAt = o.windowOpenAt.toISOString();
    dto.windowCloseAt = o.windowCloseAt.toISOString();
    return dto;
  }
}
