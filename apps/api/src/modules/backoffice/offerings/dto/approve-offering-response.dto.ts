import { ApiProperty } from '@nestjs/swagger';
import { Offering } from '@modules/offerings/entities/offering.entity';
import { OFFERING_STATUSES, OfferingStatus } from '@modules/offerings/constants/offering-status.constant';
import { ApprovalSummaryDto, EscrowSummaryDto } from './offering-summary.dto';

/**
 * 202 body for `POST /offerings/:id/approve` (TOV-154). Uniform for both a recorded-but-not-yet-quorum
 * approval and the quorum-reaching one — distinguish via `approvals.count`/`threshold` and
 * `escrow.deployStatus` (`deploying` once quorum was met). `attestedArtistAddress` is the payout the
 * approver just attested to.
 */
export class ApproveOfferingResponseDto {
  @ApiProperty() offeringId!: string;
  @ApiProperty({ enum: OFFERING_STATUSES }) status!: OfferingStatus;
  @ApiProperty({ type: ApprovalSummaryDto }) approvals!: ApprovalSummaryDto;
  @ApiProperty({ type: EscrowSummaryDto }) escrow!: EscrowSummaryDto;
  @ApiProperty({ nullable: true }) attestedArtistAddress!: string | null;

  static build(
    o: Offering,
    approvals: { count: number; threshold: number; youApproved: boolean },
  ): ApproveOfferingResponseDto {
    const dto = new ApproveOfferingResponseDto();
    dto.offeringId = o.id;
    dto.status = o.status;
    dto.approvals = { ...approvals };
    dto.escrow = {
      deployStatus: o.escrowDeployStatus,
      contractAddress: o.escrowContractAddress,
    };
    dto.attestedArtistAddress = o.snapshotArtistAddress;
    return dto;
  }
}
