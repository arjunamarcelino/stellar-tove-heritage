import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StageProgressDto {
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

  @ApiPropertyOptional({ example: null })
  startsAt!: Date | null;

  @ApiProperty({ example: true })
  isEffectivelyActive!: boolean;

  @ApiProperty({ example: 5 })
  totalMissions!: number;

  @ApiProperty({ example: 3 })
  completedMissions!: number;

  @ApiProperty({ example: false })
  isCompleted!: boolean;

  static create(params: {
    stage: {
      id: string;
      title: string;
      description: string | null;
      order: number;
      isActive: boolean;
      startsAt: Date | null;
      isEffectivelyActive: boolean;
    };
    totalMissions: number;
    completedMissions: number;
  }): StageProgressDto {
    const dto = new StageProgressDto();
    dto.id = params.stage.id;
    dto.title = params.stage.title;
    dto.description = params.stage.description;
    dto.order = params.stage.order;
    dto.isActive = params.stage.isActive;
    dto.startsAt = params.stage.startsAt;
    dto.isEffectivelyActive = params.stage.isEffectivelyActive;
    dto.totalMissions = params.totalMissions;
    dto.completedMissions = params.completedMissions;
    dto.isCompleted = params.totalMissions > 0 && params.completedMissions >= params.totalMissions;
    return dto;
  }
}
