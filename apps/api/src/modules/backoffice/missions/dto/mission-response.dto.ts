import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EvidenceType } from '@common/enums/evidence-type.enum';
import { VerificationMethod } from '@common/enums/verification-method.enum';
import { VerificationConfig } from '../entities/mission.entity';

export class MissionResponseDto {
  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  id!: string;

  @ApiProperty({ example: 'e0a1b2c3-d4e5-6789-abcd-ef0123456789' })
  stageId!: string;

  @ApiProperty({ example: 'Follow our Instagram account' })
  title!: string;

  @ApiPropertyOptional({ example: 'Follow @tove_art on Instagram and upload a screenshot' })
  description!: string | null;

  @ApiProperty({ example: 1 })
  order!: number;

  @ApiProperty({ enum: EvidenceType, example: 'file' })
  evidenceType!: EvidenceType;

  @ApiProperty({ enum: VerificationMethod, example: 'manual' })
  verificationMethod!: VerificationMethod;

  @ApiPropertyOptional({ example: { targetUsername: 'tove_art' } })
  verificationConfig!: VerificationConfig | null;

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

  static fromEntity(mission: {
    id: string;
    stageId: string;
    title: string;
    description: string | null;
    order: number;
    evidenceType: EvidenceType;
    verificationMethod: VerificationMethod;
    verificationConfig: VerificationConfig | null;
    isActive: boolean;
    createdBy: string;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): MissionResponseDto {
    const dto = new MissionResponseDto();
    dto.id = mission.id;
    dto.stageId = mission.stageId;
    dto.title = mission.title;
    dto.description = mission.description;
    dto.order = mission.order;
    dto.evidenceType = mission.evidenceType;
    dto.verificationMethod = mission.verificationMethod;
    dto.verificationConfig = mission.verificationConfig;
    dto.isActive = mission.isActive;
    dto.createdBy = mission.createdBy;
    dto.updatedBy = mission.updatedBy;
    dto.createdAt = mission.createdAt;
    dto.updatedAt = mission.updatedAt;
    return dto;
  }
}
