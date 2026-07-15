import { ApiProperty } from '@nestjs/swagger';
import type {
  ArtworkRecord,
  ArtworkStatus,
} from '../repositories/artwork-read-repository.interface';

export class ArtworkResponseDto {
  @ApiProperty({ description: 'Artwork identifier', example: 'aw-001' })
  id!: string;

  @ApiProperty({ description: 'Artwork title', example: 'Northern Lights' })
  title!: string;

  @ApiProperty({ description: 'Year the artwork was created', example: 1998 })
  year!: number;

  @ApiProperty({ description: 'Medium used', example: 'Oil on canvas' })
  medium!: string;

  @ApiProperty({ description: 'Physical dimensions', example: '80x120 cm' })
  dimensions!: string;

  @ApiProperty({ description: 'Artist handle (slug)', example: 'sophie-tove' })
  artistHandle!: string;

  @ApiProperty({ description: 'Artist display name', example: 'Sophie Tove' })
  artistName!: string;

  @ApiProperty({
    description: 'URL of the primary artwork image',
    example: 'https://cdn.tove.test/aw-001.jpg',
  })
  primaryImageUrl!: string;

  @ApiProperty({
    description: 'Anonymous-visible verification status',
    example: 'verified',
    enum: ['verified', 'published'],
  })
  status!: ArtworkStatus;

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
