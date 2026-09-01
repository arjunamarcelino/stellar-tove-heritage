import { ApiProperty } from '@nestjs/swagger';
import { Artwork } from '@modules/fractionalization/entities/artwork.entity';
import { ArtworkStatus, ARTWORK_STATUSES } from '@modules/fractionalization/constants/artwork-status.constant';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { Offering } from '@modules/offerings/entities/offering.entity';
import { FractionContractDetailDto } from './fraction-contract-detail.dto';
import { OfferingSummaryDto } from './offering-summary.dto';

/**
 * Full canonical artwork metadata for the admin detail view (TOV-240). camelCase. `status` is echoed
 * verbatim (no output validation — a drifted varchar value passes through; the frontend treats an unknown
 * status as non-actionable). `fractionContract` is the active-only projection → `null` powers the CTA gate.
 */
export class ArtworkDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  year!: number | null;

  @ApiProperty({ nullable: true })
  medium!: string | null;

  @ApiProperty({ nullable: true })
  dimensions!: string | null;

  // Intentionally exposed: admins (ADMIN/SUPERADMIN) legitimately resolve the artist by id. Admin-only
  // surface, and NOT present on the list row — kept per the PR #34 security review (todo 243).
  @ApiProperty()
  artistUserId!: string;

  @ApiProperty({ nullable: true })
  artistName!: string | null;

  @ApiProperty({ nullable: true })
  artistHandle!: string | null;

  @ApiProperty({ nullable: true })
  primaryImageUrl!: string | null;

  @ApiProperty({ enum: ARTWORK_STATUSES })
  status!: ArtworkStatus;

  @ApiProperty({ type: () => FractionContractDetailDto, nullable: true })
  fractionContract!: FractionContractDetailDto | null;

  // The single active (non-terminal) offering for this artwork, or null — powers the "Plan Offering"
  // CTA gate (TOV-153). null when there is no planned/approved/opened/subscribed offering.
  @ApiProperty({ type: () => OfferingSummaryDto, nullable: true })
  activeOffering!: OfferingSummaryDto | null;

  static fromEntity(
    artwork: Artwork,
    contract: FractionContract | null,
    activeOffering: Offering | null,
  ): ArtworkDetailDto {
    const dto = new ArtworkDetailDto();
    dto.id = artwork.id;
    dto.title = artwork.title;
    dto.year = artwork.year ?? null;
    dto.medium = artwork.medium ?? null;
    dto.dimensions = artwork.dimensions ?? null;
    dto.artistUserId = artwork.artistUserId;
    dto.artistName = artwork.artistName ?? null;
    dto.artistHandle = artwork.artistHandle ?? null;
    dto.primaryImageUrl = artwork.primaryImageUrl ?? null;
    dto.status = artwork.status;
    dto.fractionContract = contract ? FractionContractDetailDto.fromEntity(contract) : null;
    dto.activeOffering = activeOffering ? OfferingSummaryDto.fromEntity(activeOffering) : null;
    return dto;
  }
}
