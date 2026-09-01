import { ApiProperty } from '@nestjs/swagger';
import {
  ESCROW_DEPLOY_STATUSES,
  EscrowDeployStatus,
} from '@modules/offerings/constants/offering-status.constant';

/**
 * Approval-quorum progress, shared by the list / detail / approve responses (TOV-154). `count` is
 * roster-intersected (only current `OFFERING_APPROVAL_SIGNERS` members count); `youApproved` is the
 * CALLING admin. NB: the raw approver identities are deliberately NOT exposed on any surface
 * (anti-collusion, TOV-155 — an approver must not see who else signed); only the aggregate is returned.
 */
export class ApprovalSummaryDto {
  @ApiProperty({ example: 1 }) count!: number;
  @ApiProperty({ example: 2 }) threshold!: number;
  @ApiProperty({ example: false }) youApproved!: boolean;
}

/** Escrow-deploy state, shared by the list / detail / approve responses. */
export class EscrowSummaryDto {
  @ApiProperty({ enum: ESCROW_DEPLOY_STATUSES, nullable: true, example: null })
  deployStatus!: EscrowDeployStatus | null;

  @ApiProperty({ nullable: true, example: null })
  contractAddress!: string | null;
}
