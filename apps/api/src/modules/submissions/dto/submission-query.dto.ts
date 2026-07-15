import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { SubmissionStatus } from '@common/enums/submission-status.enum';

export class SubmissionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubmissionStatus, example: 'pending' })
  @IsOptional()
  @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;
}
