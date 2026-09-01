import { HttpStatus } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { User } from '@modules/users/entities/user.entity';
import { KycSubmission } from '../entities/kyc-submission.entity';

const isoOrNull = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;

/** A collector-facing reason is a lowercase snake_case CODE (e.g. `frozen_compliance_review`), never prose. */
const REASON_CODE_RE = /^[a-z0-9_]+$/;

/**
 * Which conditionally-gated fields are visible per status. `satisfies Record<KycStatus, …>` makes a
 * MISSING key a compile error — when M12 adds a 6th state, this fails to build until someone decides how
 * it gates `whitelistedAt`/`reason`. Gating is ONE-WAY: a field is null outside its state(s), but MAY be
 * null inside them too (e.g. a migrated `whitelisted` row with no timestamp).
 */
const FIELD_GATE = {
  [KycStatus.NOT_SUBMITTED]: { whitelistedAt: false, reason: false },
  [KycStatus.PENDING_REVIEW]: { whitelistedAt: false, reason: false },
  [KycStatus.WHITELISTED]: { whitelistedAt: true, reason: false },
  [KycStatus.FROZEN]: { whitelistedAt: false, reason: true },
  [KycStatus.REMOVED]: { whitelistedAt: false, reason: true },
} satisfies Record<KycStatus, { whitelistedAt: boolean; reason: boolean }>;

/**
 * GET /me/kyc/status — the caller's whitelist status card (TOV-29, FR-01.08). All four keys are ALWAYS
 * present (value `null` when N/A) so the client contract is stable — hence `@ApiProperty({ nullable })`,
 * NOT `@ApiPropertyOptional` (which would publish the keys as omittable). Never carries document data.
 */
export class WhitelistStatusResponseDto {
  @ApiProperty({ enum: KycStatus, enumName: 'KycStatus' })
  status!: KycStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  whitelistedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'frozen_compliance_review',
    description: 'Machine-readable reason code for frozen/removed (client-localized); null otherwise.',
  })
  reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSubmissionAt!: string | null;

  /**
   * `status` comes ONLY from the user row; the submission contributes ONLY its `createdAt` (never its
   * review status), so the retired `approved`/`rejected` vocabulary can't leak through this endpoint.
   */
  static build(
    user: Pick<User, 'kycStatus' | 'whitelistedAt' | 'kycReason'>,
    latest: Pick<KycSubmission, 'createdAt'> | null,
  ): WhitelistStatusResponseDto {
    // `satisfies` guards the map at compile time, but `kyc_status` is a varchar+CHECK column (not a native
    // enum), so a drifted DB value could arrive at runtime. Fail loud + typed rather than a raw
    // property-access 500 — mirrors the write path's fail-closed posture.
    const gate: { whitelistedAt: boolean; reason: boolean } | undefined = FIELD_GATE[user.kycStatus];
    if (!gate) {
      throw failHttp(ErrorCode.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR, 'Unrecognized KYC status');
    }
    const dto = new WhitelistStatusResponseDto();
    dto.status = user.kycStatus;
    dto.whitelistedAt = gate.whitelistedAt ? isoOrNull(user.whitelistedAt) : null;
    // Defense-in-depth (TOV-29 R3): surface the reason ONLY if it is a well-formed code — a mis-written
    // M12 prose value degrades to null rather than leaking internal justifications to the collector.
    dto.reason = gate.reason && REASON_CODE_RE.test(user.kycReason ?? '') ? user.kycReason : null;
    dto.lastSubmissionAt = isoOrNull(latest?.createdAt);
    return dto;
  }
}
