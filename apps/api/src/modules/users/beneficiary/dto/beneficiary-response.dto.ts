import { ApiProperty } from '@nestjs/swagger';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { Beneficiary } from '../entities/beneficiary.entity';

/**
 * Informational notice attached to every beneficiary response. Currently one code: shown when the Collector
 * is not whitelisted, reminding them KYC is required before an inheritance transfer can execute. The FE
 * switches on `code` (stable contract); `message` is display copy (subject to product/legal sign-off).
 */
export const BENEFICIARY_NOTICE = {
  KYC_REQUIRED_FOR_TRANSFER: {
    code: 'KYC_REQUIRED_FOR_TRANSFER',
    message: 'Complete KYC verification to enable inheritance transfers to this beneficiary.',
  },
} as const;

type BeneficiaryNoticeCode = (typeof BENEFICIARY_NOTICE)[keyof typeof BENEFICIARY_NOTICE]['code'];

/**
 * Whether the notice is shown for a given whitelist status. `satisfies Record<KycStatus, boolean>` makes a
 * MISSING key a compile error — when M12 adds a 6th state, this fails to build until someone decides how it
 * gates the notice. Only `whitelisted` suppresses it.
 */
const NOTICE_SHOWN = {
  [KycStatus.NOT_SUBMITTED]: true,
  [KycStatus.PENDING_REVIEW]: true,
  [KycStatus.WHITELISTED]: false,
  [KycStatus.FROZEN]: true,
  [KycStatus.REMOVED]: true,
} satisfies Record<KycStatus, boolean>;

export class BeneficiaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ type: String, nullable: true }) stellarPubkey!: string | null;
  @ApiProperty({ type: String, nullable: true }) relationship!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class BeneficiaryNoticeDto {
  @ApiProperty({
    enum: Object.values(BENEFICIARY_NOTICE).map((n) => n.code),
    example: 'KYC_REQUIRED_FOR_TRANSFER',
  })
  code!: BeneficiaryNoticeCode;
  @ApiProperty() message!: string;
}

/**
 * The `{ beneficiary, notice }` envelope returned by GET/POST/DELETE. Both keys are ALWAYS present
 * (`@ApiProperty({ nullable: true })`, not optional) so the client contract is stable.
 */
export class BeneficiaryResponseDto {
  @ApiProperty({ type: BeneficiaryDto, nullable: true }) beneficiary!: BeneficiaryDto | null;
  @ApiProperty({ type: BeneficiaryNoticeDto, nullable: true }) notice!: BeneficiaryNoticeDto | null;

  static build(row: Beneficiary | null, kycStatus: KycStatus): BeneficiaryResponseDto {
    const dto = new BeneficiaryResponseDto();
    // Field-by-field map — never spread the entity, so `userId`/`deletedAt` can't leak.
    dto.beneficiary = row
      ? {
          id: row.id,
          name: row.name,
          email: row.email,
          stellarPubkey: row.stellarPubkey,
          relationship: row.relationship,
          notes: row.notes,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      : null;
    // A drifted varchar kyc_status outside the enum falls through to "notice shown" (fail-safe `?? true`).
    // NB: this fails SAFE (drift → notice shown), unlike the sibling `WhitelistStatusResponseDto` which
    // fails LOUD (drift → 500) — deliberate: this notice is advisory, that DTO is the authoritative status.
    const shown = NOTICE_SHOWN[kycStatus] ?? true;
    dto.notice = shown ? { ...BENEFICIARY_NOTICE.KYC_REQUIRED_FOR_TRANSFER } : null;
    return dto;
  }
}
