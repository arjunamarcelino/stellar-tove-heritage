import { ApiProperty } from '@nestjs/swagger';
import { Offering } from '@modules/offerings/entities/offering.entity';
import { OFFERING_STATUSES, OfferingStatus } from '@modules/offerings/constants/offering-status.constant';
import { SETTLEMENT_PHASES, SettlementPhase } from '../settlement-phase';
import { ApprovalSummaryDto, EscrowSummaryDto } from './offering-summary.dto';

/**
 * Detail / poll-target body for `GET /offerings/:id` (TOV-154). The i128 money fields pass through as
 * strings (never coerced to `number`); Dates are `.toISOString()`'d. `attestedArtistAddress` is the
 * money-routing snapshot the approvers attest to (null until first approval).
 */
export class OfferingDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() artworkId!: string;
  @ApiProperty({ enum: OFFERING_STATUSES }) status!: OfferingStatus;
  @ApiProperty() lowPriceStroops!: string;
  @ApiProperty() highPriceStroops!: string;
  @ApiProperty() publicFloat!: string;
  @ApiProperty() windowOpenAt!: string;
  @ApiProperty() windowCloseAt!: string;
  @ApiProperty({ nullable: true }) attestedArtistAddress!: string | null;
  @ApiProperty({ type: EscrowSummaryDto }) escrow!: EscrowSummaryDto;
  @ApiProperty({ type: ApprovalSummaryDto }) approvals!: ApprovalSummaryDto;
  /**
   * TOV-160 settle-failure signal: non-null only when a settlement TERMINALLY failed and the offering is
   * resting in `subscribed` awaiting an admin re-drive. Lets the poll loop tell "settlement wedged/failed"
   * from "settlement in progress" (both otherwise sit in `subscribed`).
   */
  @ApiProperty({ nullable: true }) settleFailedAt!: string | null;
  @ApiProperty({ nullable: true }) settleFailureReason!: string | null;
  /**
   * FR-05.06 settlement vocabulary derived from `status` + `windowCloseAt` (TOV-165). `null` when the offering
   * is not in a settlement-relevant phase (planning/approval, or `opened` with the window still open). Computed
   * by the caller with one clock reading per response (a pure mapper must not read the wall clock).
   */
  @ApiProperty({ enum: SETTLEMENT_PHASES, nullable: true }) settlementPhase!: SettlementPhase;

  static build(
    o: Offering,
    approvals: { count: number; threshold: number; youApproved: boolean },
    settlementPhase: SettlementPhase,
  ): OfferingDetailDto {
    const dto = new OfferingDetailDto();
    dto.id = o.id;
    dto.artworkId = o.artworkId;
    dto.status = o.status;
    dto.lowPriceStroops = o.lowPriceStroops;
    dto.highPriceStroops = o.highPriceStroops;
    dto.publicFloat = o.publicFloat;
    dto.windowOpenAt = o.windowOpenAt.toISOString();
    dto.windowCloseAt = o.windowCloseAt.toISOString();
    dto.attestedArtistAddress = o.snapshotArtistAddress;
    dto.settleFailedAt = o.settleFailedAt ? o.settleFailedAt.toISOString() : null;
    dto.settleFailureReason = o.settleFailureReason;
    dto.settlementPhase = settlementPhase;
    dto.escrow = {
      deployStatus: o.escrowDeployStatus,
      contractAddress: o.escrowContractAddress,
    };
    dto.approvals = {
      count: approvals.count,
      threshold: approvals.threshold,
      youApproved: approvals.youApproved,
    };
    return dto;
  }
}
