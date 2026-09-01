import { ApiProperty } from '@nestjs/swagger';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';

/** 202 body for the fractionalize request + GET status projection (TOV-233). */
export class FractionalizationResponseDto {
  @ApiProperty() artworkId!: string;
  @ApiProperty() fractionContractId!: string;
  @ApiProperty({ enum: ['deploying', 'deployed', 'failed'] })
  status!: FractionContract['status'];
  @ApiProperty({ nullable: true, description: 'Deployed FractionToken contract (C…); null until deployed' })
  tokenAddress!: string | null;

  static fromEntity(fc: FractionContract): FractionalizationResponseDto {
    const dto = new FractionalizationResponseDto();
    dto.artworkId = fc.artworkId;
    dto.fractionContractId = fc.id;
    dto.status = fc.status;
    dto.tokenAddress = fc.tokenAddress;
    return dto;
  }
}
