import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EvidenceType } from '@common/enums/evidence-type.enum';

export class MissionSummaryDto {
  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  id!: string;

  @ApiProperty({ example: 'Follow our Instagram account' })
  title!: string;

  @ApiPropertyOptional({ example: 'Follow @tove_art on Instagram and upload a screenshot' })
  description!: string | null;

  @ApiProperty({ example: 1 })
  order!: number;

  @ApiProperty({ enum: EvidenceType, example: 'file' })
  evidenceType!: EvidenceType;

  static fromEntity(mission: {
    id: string;
    title: string;
    description: string | null;
    order: number;
    evidenceType: EvidenceType;
  }): MissionSummaryDto {
    const dto = new MissionSummaryDto();
    dto.id = mission.id;
    dto.title = mission.title;
    dto.description = mission.description;
    dto.order = mission.order;
    dto.evidenceType = mission.evidenceType;
    return dto;
  }
}
