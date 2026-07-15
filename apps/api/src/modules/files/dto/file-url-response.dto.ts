import { ApiProperty } from '@nestjs/swagger';

export class FileUrlResponseDto {
  @ApiProperty({
    description: 'Temporary signed URL for direct file download',
    example: 'https://storage.example.com/files/abc.pdf?token=...&expires=...',
  })
  url!: string;

  @ApiProperty({
    description: 'Seconds until the signed URL expires',
    example: 3600,
  })
  expiresIn!: number;

  @ApiProperty({
    description: 'Original filename of the uploaded PDF',
    example: 'annual-report.pdf',
  })
  filename!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 729448,
  })
  fileSize!: number;

  static create(params: {
    url: string;
    expiresIn: number;
    filename: string;
    fileSize: number;
  }): FileUrlResponseDto {
    const dto = new FileUrlResponseDto();
    dto.url = params.url;
    dto.expiresIn = params.expiresIn;
    dto.filename = params.filename;
    dto.fileSize = params.fileSize;
    return dto;
  }
}
