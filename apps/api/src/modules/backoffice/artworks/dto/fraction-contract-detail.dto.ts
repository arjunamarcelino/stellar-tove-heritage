import { ApiProperty } from '@nestjs/swagger';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import {
  ACTIVE_FRACTION_STATUSES,
  ActiveFractionStatus,
  assertActiveStatus,
} from '../constants/active-fraction-status';

/**
 * Fuller fraction-contract projection for the artwork DETAIL view (TOV-240). Active-only (never `failed`).
 * Deliberately NOT the existing `FractionalizationResponseDto` — different shape (top-level vs nested,
 * `failed` allowed there) — so the two read models can evolve independently.
 */
export class FractionContractDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: [...ACTIVE_FRACTION_STATUSES] })
  status!: ActiveFractionStatus;

  @ApiProperty({ nullable: true, description: 'Deployed FractionToken contract address (C…), null while deploying' })
  tokenAddress!: string | null;

  @ApiProperty({ type: 'string', example: '1000000', description: 'i128 total supply (numeric → string)' })
  totalSupply!: string;

  @ApiProperty({ example: 10 })
  artistRetentionPct!: number;

  @ApiProperty({ example: 5 })
  treasuryRetentionPct!: number;

  @ApiProperty({ example: 365 })
  artistLockupDays!: number;

  @ApiProperty({ example: 730 })
  treasuryLockupDays!: number;

  @ApiProperty({ example: 'Northern Lights' })
  tokenName!: string;

  @ApiProperty({ example: 'NLIGHT' })
  tokenSymbol!: string;

  static fromEntity(fc: FractionContract): FractionContractDetailDto {
    const dto = new FractionContractDetailDto();
    dto.id = fc.id;
    dto.status = assertActiveStatus(fc.status);
    dto.tokenAddress = fc.tokenAddress ?? null;
    dto.totalSupply = fc.totalSupply;
    dto.artistRetentionPct = fc.artistRetentionPct;
    dto.treasuryRetentionPct = fc.treasuryRetentionPct;
    dto.artistLockupDays = fc.artistLockupDays;
    dto.treasuryLockupDays = fc.treasuryLockupDays;
    dto.tokenName = fc.tokenName;
    dto.tokenSymbol = fc.tokenSymbol;
    return dto;
  }
}
