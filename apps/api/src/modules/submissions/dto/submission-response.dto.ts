import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubmissionStatus } from '@common/enums/submission-status.enum';

export class SubmissionResponseDto {
  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  id!: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' })
  userId!: string;

  @ApiProperty({ example: 'e0a1b2c3-d4e5-6789-abcd-ef0123456789' })
  missionId!: string;

  @ApiProperty({ enum: SubmissionStatus, example: 'pending' })
  status!: SubmissionStatus;

  @ApiPropertyOptional({ example: 'https://storage.example.com/evidence/photo.png' })
  fileUrl!: string | null;

  @ApiPropertyOptional({ example: 'https://x.com/tove_art' })
  linkUrl!: string | null;

  @ApiPropertyOptional({ example: 'I joined the Discord server and my username is ToveUser#1234' })
  textContent!: string | null;

  @ApiPropertyOptional({ example: 'Evidence verified successfully' })
  adminNotes!: string | null;

  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  reviewedBy!: string | null;

  @ApiPropertyOptional({ example: '2026-06-01T14:00:00.000Z' })
  reviewedAt!: Date | null;

  @ApiProperty({ example: '2026-05-31T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-05-31T12:00:00.000Z' })
  updatedAt!: Date;

  static fromEntity(submission: {
    id: string;
    userId: string;
    missionId: string;
    status: SubmissionStatus;
    fileUrl: string | null;
    linkUrl: string | null;
    textContent: string | null;
    adminNotes: string | null;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SubmissionResponseDto {
    const dto = new SubmissionResponseDto();
    dto.id = submission.id;
    dto.userId = submission.userId;
    dto.missionId = submission.missionId;
    dto.status = submission.status;
    dto.fileUrl = submission.fileUrl;
    dto.linkUrl = submission.linkUrl;
    dto.textContent = submission.textContent;
    dto.adminNotes = submission.adminNotes;
    dto.reviewedBy = submission.reviewedBy;
    dto.reviewedAt = submission.reviewedAt;
    dto.createdAt = submission.createdAt;
    dto.updatedAt = submission.updatedAt;
    return dto;
  }
}
