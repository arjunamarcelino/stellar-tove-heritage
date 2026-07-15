import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsInt,
  Min,
  IsOptional,
  IsEnum,
  IsUUID,
  IsObject,
  ValidateNested,
  ValidateIf,
  IsNotEmptyObject,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EvidenceType } from '@common/enums/evidence-type.enum';
import { VerificationMethod } from '@common/enums/verification-method.enum';
import { VerificationConfigDto } from './verification-config.dto';

export class CreateMissionDto {
  @ApiProperty({ example: 'Follow our Instagram account' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 'Follow @tove_art on Instagram and upload a screenshot' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiProperty({ example: 'e0a1b2c3-d4e5-6789-abcd-ef0123456789', description: 'Stage ID' })
  @IsUUID()
  stageId!: string;

  @ApiProperty({ enum: EvidenceType, example: 'file' })
  @IsEnum(EvidenceType)
  evidenceType!: EvidenceType;

  @ApiPropertyOptional({ enum: VerificationMethod, example: 'manual', default: 'manual' })
  @IsOptional()
  @IsEnum(VerificationMethod)
  verificationMethod?: VerificationMethod;

  @ApiPropertyOptional({ example: { targetUsername: 'tove_art' } })
  @ValidateIf((o: CreateMissionDto) =>
    o.verificationMethod === VerificationMethod.AUTO_X_FOLLOW ||
    o.verificationMethod === VerificationMethod.AUTO_INSTAGRAM_FOLLOW,
  )
  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => VerificationConfigDto)
  verificationConfig?: VerificationConfigDto;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
