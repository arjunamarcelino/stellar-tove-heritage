import { ApiProperty } from '@nestjs/swagger';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import {
  ACTIVE_FRACTION_STATUSES,
  ActiveFractionStatus,
  assertActiveStatus,
} from '../constants/active-fraction-status';

/** Compact fraction-contract projection for an artwork LIST row (TOV-240). Active-only, so never `failed`. */
export class FractionContractSummaryDto {
  @ApiProperty({ enum: [...ACTIVE_FRACTION_STATUSES] })
  status!: ActiveFractionStatus;

  @ApiProperty({ nullable: true, description: 'Deployed FractionToken contract address (C…), null while deploying' })
  tokenAddress!: string | null;

  static fromEntity(fc: FractionContract): FractionContractSummaryDto {
    const dto = new FractionContractSummaryDto();
    dto.status = assertActiveStatus(fc.status);
    dto.tokenAddress = fc.tokenAddress ?? null;
    return dto;
  }
}
