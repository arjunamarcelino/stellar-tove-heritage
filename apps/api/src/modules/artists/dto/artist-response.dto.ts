import { ApiProperty } from '@nestjs/swagger';
import type { ArtistRecord } from '../repositories/artist-read-repository.interface';

export class ArtistResponseDto {
  @ApiProperty({ description: 'URL-safe slug identifying the artist', example: 'sophie-tove' })
  handle!: string;

  @ApiProperty({ description: 'Artist display name', example: 'Sophie Tove' })
  name!: string;

  static fromRecord(record: ArtistRecord): ArtistResponseDto {
    const dto = new ArtistResponseDto();
    dto.handle = record.handle;
    dto.name = record.name;
    return dto;
  }
}
