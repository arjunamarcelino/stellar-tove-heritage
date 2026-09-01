import { ApiProperty } from '@nestjs/swagger';
import { Artwork } from '@modules/fractionalization/entities/artwork.entity';
import { ArtworkStatus, ARTWORK_STATUSES } from '@modules/fractionalization/constants/artwork-status.constant';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { FractionContractSummaryDto } from './fraction-contract-summary.dto';

/** One row of the admin artwork list (TOV-240). camelCase; `fractionContract` is the active-only projection. */
export class ArtworkListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  artistName!: string | null;

  @ApiProperty({ nullable: true })
  artistHandle!: string | null;

  @ApiProperty({ nullable: true })
  primaryImageUrl!: string | null;

  @ApiProperty({ enum: ARTWORK_STATUSES })
  status!: ArtworkStatus;

  @ApiProperty({ type: () => FractionContractSummaryDto, nullable: true })
  fractionContract!: FractionContractSummaryDto | null;

  static fromEntity(artwork: Artwork, contract: FractionContract | null): ArtworkListItemDto {
    const dto = new ArtworkListItemDto();
    dto.id = artwork.id;
    dto.title = artwork.title;
    dto.artistName = artwork.artistName ?? null;
    dto.artistHandle = artwork.artistHandle ?? null;
    dto.primaryImageUrl = artwork.primaryImageUrl ?? null;
    dto.status = artwork.status;
    dto.fractionContract = contract ? FractionContractSummaryDto.fromEntity(contract) : null;
    return dto;
  }
}
