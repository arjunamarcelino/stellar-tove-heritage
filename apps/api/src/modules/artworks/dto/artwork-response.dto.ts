import { ApiProperty } from '@nestjs/swagger';
import { PUBLIC_VISIBLE_STATUSES } from '../constants/artwork-visibility.constant';
import type {
  ArtworkRecord,
  PublicArtworkStatus,
} from '../repositories/artwork-read-repository.interface';

export class ArtworkResponseDto {
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
    description: 'URL of the primary artwork image (absolute CDN URL)',
    example: 'https://cdn.tove.test/aw-001.jpg',
    nullable: true,
  })
  primaryImageUrl!: string | null;

  @ApiProperty({
    description: 'Anonymous-visible artwork status',
    example: 'verified',
    enum: PUBLIC_VISIBLE_STATUSES,
  })
  status!: PublicArtworkStatus;

  static fromRecord(record: ArtworkRecord): ArtworkResponseDto {
    const dto = new ArtworkResponseDto();
    dto.id = record.id;
    dto.title = record.title;
    dto.year = record.year;
    dto.medium = record.medium;
    dto.dimensions = record.dimensions;
    dto.artistHandle = record.artistHandle;
    dto.artistName = record.artistName;
    dto.primaryImageUrl = record.primaryImageUrl;
    dto.status = record.status;
    return dto;
  }
}
