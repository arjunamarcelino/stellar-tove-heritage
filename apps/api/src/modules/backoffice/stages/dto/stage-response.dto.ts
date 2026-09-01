import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StageResponseDto {
  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  id!: string;

  @ApiProperty({ example: 'Getting Started' })
  title!: string;

  @ApiPropertyOptional({ example: 'Complete these introductory tasks to begin your journey' })
  description!: string | null;

  @ApiProperty({ example: 1 })
  order!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ example: '2026-07-01T00:00:00.000Z' })
  startsAt!: Date | null;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  createdBy!: string;

  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  updatedBy!: string | null;

  @ApiProperty({ example: '2026-05-31T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-05-31T12:00:00.000Z' })
  updatedAt!: Date;

  static fromEntity(stage: {
    id: string;
    title: string;
    description: string | null;
    order: number;
    isActive: boolean;
    startsAt: Date | null;
    createdBy: string;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): StageResponseDto {
    const dto = new StageResponseDto();
    dto.id = stage.id;
    dto.title = stage.title;
    dto.description = stage.description;
    dto.order = stage.order;
    dto.isActive = stage.isActive;
    dto.startsAt = stage.startsAt;
    dto.createdBy = stage.createdBy;
    dto.updatedBy = stage.updatedBy;
    dto.createdAt = stage.createdAt;
    dto.updatedAt = stage.updatedAt;
    return dto;
  }
}
