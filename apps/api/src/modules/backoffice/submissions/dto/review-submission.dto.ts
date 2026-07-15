import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubmissionStatus } from '@common/enums/submission-status.enum';

export class ReviewSubmissionDto {
  @ApiProperty({ enum: [SubmissionStatus.ACCEPTED, SubmissionStatus.REJECTED], example: 'accepted' })
  @IsEnum(SubmissionStatus)
  @IsIn([SubmissionStatus.ACCEPTED, SubmissionStatus.REJECTED])
  status!: SubmissionStatus.ACCEPTED | SubmissionStatus.REJECTED;

  @ApiPropertyOptional({ example: 'Evidence verified successfully' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNotes?: string;
}
