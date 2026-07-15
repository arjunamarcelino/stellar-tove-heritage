import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { SubmissionStatus } from '@common/enums/submission-status.enum';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

export class SubmissionFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'f1a2b3c4-d5e6-7890-abcd-ef0123456789' })
  @IsOptional()
  @IsUUID()
  missionId?: string;

  @ApiPropertyOptional({ enum: SubmissionStatus, example: 'pending' })
  @IsOptional()
  @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
