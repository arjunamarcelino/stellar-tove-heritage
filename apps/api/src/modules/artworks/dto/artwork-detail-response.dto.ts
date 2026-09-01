import { ApiProperty } from '@nestjs/swagger';
import { PUBLIC_VISIBLE_STATUSES } from '../constants/artwork-visibility.constant';
import type {
  ArtworkDetailRecord,
  PublicArtworkStatus,
} from '../repositories/artwork-read-repository.interface';

/** Already-signed asset URLs computed by the service (never raw storage paths). */
export interface SignedArtworkAssets {
  supportingImages: string[];
  coaSignedUrl: string | null;
}

export class ArtworkDetailResponseDto {
  @ApiProperty({ description: 'Artwork identifier (UUID)', example: '00000000-0000-4000-8000-0000000a0001' })
  id!: string;

  @ApiProperty({ description: 'Artwork title', example: 'Northern Lights' })
  title!: string;

  @ApiProperty({ description: 'Year the artwork was created', example: 1998, nullable: true })
  year!: number | null;

  @ApiProperty({ description: 'Medium used', example: 'Oil on canvas', nullable: true })
  medium!: string | null;

  @ApiProperty({ description: 'Physical dimensions', example: '80x120 cm', nullable: true })
  dimensions!: string | null;

  @ApiProperty({ description: 'Artist handle (slug)', example: 'sophie-tove', nullable: true })
  artistHandle!: string | null;

  @ApiProperty({ description: 'Artist display name', example: 'Sophie Tove', nullable: true })
  artistName!: string | null;

  @ApiProperty({
    description: 'Primary artwork image (absolute CDN URL)',
    example: 'https://cdn.tove.test/aw-001.jpg',
    nullable: true,
  })
  primaryImageUrl!: string | null;

  @ApiProperty({
    description: 'Supporting images as 1h signed CDN URLs, ordered by sort order',
    type: [String],
    example: ['https://signed.example/aw-001-1.jpg?token=…'],
  })
  supportingImages!: string[];

  @ApiProperty({
    description: 'Certificate of Authenticity as a 1h signed URL; null when absent',
    example: 'https://signed.example/aw-001-coa.pdf?token=…',
    nullable: true,
  })
  coaSignedUrl!: string | null;

  @ApiProperty({
    description: 'Current custodian (public display label)',
    example: 'Tove Vault, Oslo',
    nullable: true,
  })
  custodian!: string | null;

  @ApiProperty({
    description: 'Anonymous-visible artwork status',
    example: 'verified',
    enum: PUBLIC_VISIBLE_STATUSES,
  })
  status!: PublicArtworkStatus;

  /**
   * URL/asset fields come ONLY from `signed`; everything else from `record`. The raw `record` is never
   * spread, so its storage paths (`coaStoragePath`, image paths) can never leak into the response.
   */
  static build(record: ArtworkDetailRecord, signed: SignedArtworkAssets): ArtworkDetailResponseDto {
    const dto = new ArtworkDetailResponseDto();
    dto.id = record.id;
    dto.title = record.title;
    dto.year = record.year;
    dto.medium = record.medium;
    dto.dimensions = record.dimensions;
    dto.artistHandle = record.artistHandle;
    dto.artistName = record.artistName;
    dto.primaryImageUrl = record.primaryImageUrl; // passthrough absolute CDN URL
    dto.supportingImages = signed.supportingImages;
    dto.coaSignedUrl = signed.coaSignedUrl;
    dto.custodian = record.custodian;
    dto.status = record.status;
    return dto;
  }
}
