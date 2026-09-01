import { describe, it, expect } from 'vitest';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { WhitelistStatusResponseDto } from '@modules/kyc/dto/whitelist-status-response.dto';
import type { User } from '@modules/users/entities/user.entity';
import type { KycSubmission } from '@modules/kyc/entities/kyc-submission.entity';

/** The narrow user slice `build` reads — cast to the `Pick<User, …>` shape without a full entity. */
type UserSlice = Pick<User, 'kycStatus' | 'whitelistedAt' | 'kycReason'>;

function userSlice(
  kycStatus: KycStatus,
  whitelistedAt: Date | null,
  kycReason: string | null,
): UserSlice {
  return { kycStatus, whitelistedAt, kycReason };
}

/** Minimal submission — `build` only reads `createdAt`, so its param is a `Pick`; no cast needed. */
function submission(createdAt: Date): Pick<KycSubmission, 'createdAt'> {
  return { createdAt };
}

const WHITELISTED_AT = new Date('2026-07-17T10:00:00.000Z');
const SUBMITTED_AT = new Date('2026-07-15T09:00:00.000Z');
const STALE_WHITELISTED_AT = new Date('2026-01-01T00:00:00.000Z');

const EXPECTED_KEYS = ['lastSubmissionAt', 'reason', 'status', 'whitelistedAt'];

describe('WhitelistStatusResponseDto.build', () => {
  it('not_submitted (no latest) → all conditional fields null', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.NOT_SUBMITTED, null, null),
      null,
    );

    expect(dto).toEqual({
      status: KycStatus.NOT_SUBMITTED,
      whitelistedAt: null,
      reason: null,
      lastSubmissionAt: null,
    });
  });

  it('pending_review with a latest submission → lastSubmissionAt set, whitelistedAt/reason null', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.PENDING_REVIEW, null, null),
      submission(SUBMITTED_AT),
    );

    expect(dto.status).toBe(KycStatus.PENDING_REVIEW);
    expect(dto.lastSubmissionAt).toBe(SUBMITTED_AT.toISOString());
    expect(dto.whitelistedAt).toBeNull();
    expect(dto.reason).toBeNull();
  });

  it('whitelisted WITH a whitelistedAt Date → whitelistedAt is its ISO, reason null', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.WHITELISTED, WHITELISTED_AT, null),
      submission(SUBMITTED_AT),
    );

    expect(dto.status).toBe(KycStatus.WHITELISTED);
    expect(dto.whitelistedAt).toBe(WHITELISTED_AT.toISOString());
    expect(dto.reason).toBeNull();
  });

  it('whitelisted WITH whitelistedAt NULL (migrated legacy row) → whitelistedAt null (one-way gate)', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.WHITELISTED, null, null),
      submission(SUBMITTED_AT),
    );

    expect(dto.status).toBe(KycStatus.WHITELISTED);
    expect(dto.whitelistedAt).toBeNull();
    expect(dto.reason).toBeNull();
  });

  it('frozen with a stale whitelistedAt → reason set, whitelistedAt NULL (freeze-leak guard)', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.FROZEN, STALE_WHITELISTED_AT, 'frozen_compliance_review'),
      submission(SUBMITTED_AT),
    );

    expect(dto.status).toBe(KycStatus.FROZEN);
    expect(dto.reason).toBe('frozen_compliance_review');
    // A stale timestamp must NOT surface once frozen.
    expect(dto.whitelistedAt).toBeNull();
  });

  it('removed with kycReason → reason set, whitelistedAt null', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.REMOVED, null, 'removed_by_request'),
      submission(SUBMITTED_AT),
    );

    expect(dto.status).toBe(KycStatus.REMOVED);
    expect(dto.reason).toBe('removed_by_request');
    expect(dto.whitelistedAt).toBeNull();
  });

  it('always has EXACTLY the 4 keys present, even when 3 are null (null present, not absent)', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.NOT_SUBMITTED, null, null),
      null,
    );

    expect(Object.keys(dto).sort()).toEqual(EXPECTED_KEYS);
    // The keys exist with an explicit null value, not merely undefined/absent.
    expect(dto).toHaveProperty('whitelistedAt', null);
    expect(dto).toHaveProperty('reason', null);
    expect(dto).toHaveProperty('lastSubmissionAt', null);
  });

  it('whitelistedAt/lastSubmissionAt serialize as ISO-8601 UTC ending in Z', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.WHITELISTED, WHITELISTED_AT, null),
      submission(SUBMITTED_AT),
    );

    expect(dto.whitelistedAt).toMatch(/\dT.*Z$/);
    expect(dto.lastSubmissionAt).toMatch(/\dT.*Z$/);
    expect(dto.whitelistedAt).toBe('2026-07-17T10:00:00.000Z');
    expect(dto.lastSubmissionAt).toBe('2026-07-15T09:00:00.000Z');
  });

  it('frozen with a non-code (prose) reason → reason null (never leaks free-text to the collector)', () => {
    const dto = WhitelistStatusResponseDto.build(
      userSlice(KycStatus.FROZEN, null, 'Suspected sanctions match, case #4471'),
      null,
    );

    expect(dto.status).toBe(KycStatus.FROZEN);
    expect(dto.reason).toBeNull(); // prose fails the code-shape guard
  });

  it('an unknown/drifted kyc_status throws a typed 500, not a raw TypeError', () => {
    let caught: unknown;
    try {
      // Simulate a DB value outside the 5 enum members (varchar+CHECK column, not a native enum).
      WhitelistStatusResponseDto.build(userSlice('suspended' as KycStatus, null, null), null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 500, response: { errorCode: 'INTERNAL_ERROR' } });
  });
});
