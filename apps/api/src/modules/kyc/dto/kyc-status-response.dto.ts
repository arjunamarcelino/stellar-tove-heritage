import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycSubmission } from '../entities/kyc-submission.entity';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { KycSubmissionStatus } from '../enums/kyc-submission-status.enum';

/** The caller's most-recent submission, surfaced by GET /me/kyc. Never includes document data. */
export class KycLatestSubmissionDto {
  @ApiProperty({ format: 'uuid' })
  submissionId!: string;

  @ApiProperty({ enum: KycSubmissionStatus })
  status!: KycSubmissionStatus;

  @ApiProperty({ example: 'GB' })
  claimedJurisdiction!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/**
 * GET /me/kyc — the caller's KYC state so the UI can render/poll (TOV-28 O2). Returns only status
 * metadata; document bytes/keys/signed URLs are the later read ticket, out of scope here.
 */
export class KycStatusResponseDto {
  @ApiProperty({ enum: KycStatus })
  kycStatus!: KycStatus;

  @ApiPropertyOptional({ type: KycLatestSubmissionDto, nullable: true })
  latestSubmission!: KycLatestSubmissionDto | null;

  static build(kycStatus: KycStatus, latest: KycSubmission | null): KycStatusResponseDto {
    const dto = new KycStatusResponseDto();
    dto.kycStatus = kycStatus;
    dto.latestSubmission = latest
      ? {
          submissionId: latest.id,
          status: latest.status,
          claimedJurisdiction: latest.claimedJurisdiction,
          createdAt: latest.createdAt.toISOString(),
        }
      : null;
    return dto;
  }
}
