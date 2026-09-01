import { describe, it, expect } from 'vitest';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { KycSubmissionStatus } from '@modules/kyc/enums/kyc-submission-status.enum';

/**
 * Enum <-> DB CHECK-constraint parity guard.
 *
 * The `KycStatus` values below MUST stay in lock-step with the `CHK_users_kyc_status` CHECK defined in
 * migration 1716000000026 (EvolveKycWhitelistStatus):
 *   kyc_status IN ('not_submitted','pending_review','whitelisted','frozen','removed')
 *
 * If someone edits the enum without the migration (or vice-versa), these tests fail. `KycSubmissionStatus`
 * is a DISTINCT per-submission axis and is asserted separately so its retained `approved`/`rejected`
 * vocabulary is documented as intentional.
 */
describe('KycStatus / KycSubmissionStatus enums', () => {
  it('KycStatus has EXACTLY the 5 whitelist-lifecycle values in the DB CHECK', () => {
    expect(Object.values(KycStatus).sort()).toEqual([
      'frozen',
      'not_submitted',
      'pending_review',
      'removed',
      'whitelisted',
    ]);
  });

  it('KycStatus contains no retired review-outcome vocabulary (approved/rejected)', () => {
    expect(Object.values(KycStatus)).not.toContain('approved');
    expect(Object.values(KycStatus)).not.toContain('rejected');
  });

  it('KycSubmissionStatus (distinct per-submission axis) is unchanged', () => {
    expect(Object.values(KycSubmissionStatus).sort()).toEqual([
      'approved',
      'pending_review',
      'rejected',
    ]);
  });
});
