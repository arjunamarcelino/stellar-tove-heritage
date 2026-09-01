import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FileResponseDto {
  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  id!: string;

  @ApiProperty({ example: 'Annual Report 2026' })
  title!: string;

  @ApiProperty({ example: 'annual-report-2026' })
  urlPath!: string;

  @ApiProperty({ example: 1048576 })
  fileSize!: number;

  @ApiProperty({ example: 'report.pdf' })
  originalFilename!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  createdBy!: string;

  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  updatedBy!: string | null;

  @ApiProperty({ example: '2026-05-31T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-05-31T12:00:00.000Z' })
  updatedAt!: Date;

  static fromEntity(file: {
    id: string;
    title: string;
    urlPath: string;
    fileSize: number;
    originalFilename: string;
    isActive: boolean;
    createdBy: string;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): FileResponseDto {
    const dto = new FileResponseDto();
    dto.id = file.id;
    dto.title = file.title;
    dto.urlPath = file.urlPath;
    dto.fileSize = file.fileSize;
    dto.originalFilename = file.originalFilename;
    dto.isActive = file.isActive;
    dto.createdBy = file.createdBy;
    dto.updatedBy = file.updatedBy;
    dto.createdAt = file.createdAt;
    dto.updatedAt = file.updatedAt;
    return dto;
  }
}
