import { ApiProperty } from '@nestjs/swagger';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { KycSubmissionStatus } from '../enums/kyc-submission-status.enum';

/**
 * The 202 body for a KYC submission. Deliberately minimal — it never carries storage keys, DEKs, or
 * document bytes. `kycStatus` comes from the USER (not the submission row), so `fromEntity` takes it
 * explicitly rather than pretending the two are one aggregate.
 */
export class KycSubmissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  submissionId!: string;

  @ApiProperty({ enum: KycSubmissionStatus })
  status!: KycSubmissionStatus;

  @ApiProperty({ enum: KycStatus })
  kycStatus!: KycStatus;

  static fromEntity(
    submission: { id: string; status: KycSubmissionStatus },
    kycStatus: KycStatus,
  ): KycSubmissionResponseDto {
    const dto = new KycSubmissionResponseDto();
    dto.submissionId = submission.id;
    dto.status = submission.status;
    dto.kycStatus = kycStatus;
    return dto;
  }
}
