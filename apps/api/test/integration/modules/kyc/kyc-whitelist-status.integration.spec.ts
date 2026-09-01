import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { User } from '@modules/users/entities/user.entity';
import { KycSubmission } from '@modules/kyc/entities/kyc-submission.entity';
import { KycDocument } from '@modules/kyc/entities/kyc-document.entity';
import { KycService } from '@modules/kyc/kyc.service';
import { KycCryptoService } from '@modules/kyc/crypto/kyc-crypto.service';
import { KycSubmissionRepository } from '@modules/kyc/repositories/kyc-submission.repository';
import { KYC_SUBMISSION_REPOSITORY } from '@modules/kyc/repositories/kyc-submission-repository.interface';
import { KYC_STORAGE } from '@modules/kyc/kyc.util';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { kycConfig } from '@config/kyc.config';

// getWhitelistStatus only touches the users + submissions repositories; the other KycService deps are
// stubbed just to satisfy DI. This drives the REAL service method (projection + findLatestByUser + DTO)
// against the real tove_test schema — the value this integration adds over the pure-unit DTO test.
@Module({
  imports: [TypeOrmModule.forFeature([User, KycSubmission, KycDocument])],
  providers: [
    KycService,
    { provide: KYC_SUBMISSION_REPOSITORY, useClass: KycSubmissionRepository },
    { provide: KYC_STORAGE, useValue: {} },
    { provide: KycCryptoService, useValue: {} },
    { provide: IdempotencyStore, useValue: {} },
    { provide: AuditLogService, useValue: {} },
    { provide: kycConfig.KEY, useValue: { jurisdictionAllowlist: [] } },
  ],
})
class TestKycStatusModule {}

interface Seed {
  status: KycStatus;
  whitelistedAt?: string | null;
  reason?: string | null;
}

describe('KYC whitelist status (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: KycService;

  beforeAll(async () => {
    module = await createTestingModule(TestKycStatusModule);
    dataSource = module.get(DataSource);
    service = module.get(KycService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  /** Insert a user in a given whitelist state (+ optional metadata) and return its id. */
  async function seedUser(email: string, seed: Seed): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      `INSERT INTO users (email, is_active, kyc_status, whitelisted_at, kyc_reason)
       VALUES ($1, true, $2, $3, $4) RETURNING id`,
      [email, seed.status, seed.whitelistedAt ?? null, seed.reason ?? null],
    );
    return rows[0].id;
  }

  /** Insert a submission (default pending_review) at an explicit created_at; return its id. */
  async function seedSubmission(userId: string, createdAt: string, status = 'pending_review'): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      `INSERT INTO kyc_submissions (user_id, status, claimed_jurisdiction, created_at)
       VALUES ($1, $2, 'GB', $3) RETURNING id`,
      [userId, status, createdAt],
    );
    return rows[0].id;
  }

  it('not_submitted with no submission → all metadata null', async () => {
    const userId = await seedUser('u1@example.com', { status: KycStatus.NOT_SUBMITTED });
    const res = await service.getWhitelistStatus(userId);
    expect(res).toEqual({ status: KycStatus.NOT_SUBMITTED, whitelistedAt: null, reason: null, lastSubmissionAt: null });
  });

  it('whitelisted surfaces whitelistedAt (ISO-8601 UTC); reason null', async () => {
    const userId = await seedUser('u3@example.com', {
      status: KycStatus.WHITELISTED,
      whitelistedAt: '2026-07-17T10:00:00.000Z',
    });
    const res = await service.getWhitelistStatus(userId);
    expect(res.status).toBe('whitelisted');
    expect(res.whitelistedAt).toBe('2026-07-17T10:00:00.000Z');
    expect(res.reason).toBeNull();
  });

  it('frozen surfaces the reason code and does NOT leak a stale whitelisted_at (freeze-leak guard)', async () => {
    const userId = await seedUser('u4@example.com', {
      status: KycStatus.FROZEN,
      whitelistedAt: '2026-07-01T00:00:00.000Z', // historical; must NOT be surfaced
      reason: 'frozen_compliance_review',
    });
    const res = await service.getWhitelistStatus(userId);
    expect(res.status).toBe('frozen');
    expect(res.reason).toBe('frozen_compliance_review');
    expect(res.whitelistedAt).toBeNull();
  });

  // `pending_review` (lastSubmissionAt) is covered by the decoupling + soft-delete tests below; `removed`
  // shares `frozen`'s gate row, so `frozen` above is the representative reason-gate case at this layer.
  it('decouples status from submissions: not_submitted user WITH a submission still reports lastSubmissionAt', async () => {
    const userId = await seedUser('u6@example.com', { status: KycStatus.NOT_SUBMITTED });
    await seedSubmission(userId, '2026-07-10T08:00:00.000Z', 'rejected');
    const res = await service.getWhitelistStatus(userId);
    expect(res.status).toBe('not_submitted');
    expect(res.lastSubmissionAt).toBe('2026-07-10T08:00:00.000Z'); // status must not imply "no submission"
  });

  it('lastSubmissionAt ignores soft-deleted submissions (newest soft-deleted → older live row)', async () => {
    const userId = await seedUser('u7@example.com', { status: KycStatus.PENDING_REVIEW });
    // Older row is 'rejected' (still live) so it doesn't collide with the newer pending row on the
    // one-live-pending-per-user partial index; it stays the newest NON-deleted row after the soft-delete.
    await seedSubmission(userId, '2026-07-01T00:00:00.000Z', 'rejected'); // older, live
    const newerId = await seedSubmission(userId, '2026-07-20T00:00:00.000Z'); // newest, pending
    await dataSource.query(`UPDATE kyc_submissions SET deleted_at = now() WHERE id = $1`, [newerId]);

    const res = await service.getWhitelistStatus(userId);
    expect(res.lastSubmissionAt).toBe('2026-07-01T00:00:00.000Z'); // the soft-deleted newest is excluded
  });

  it('lastSubmissionAt is null when the only submission is soft-deleted', async () => {
    const userId = await seedUser('u8@example.com', { status: KycStatus.NOT_SUBMITTED });
    const onlyId = await seedSubmission(userId, '2026-07-05T00:00:00.000Z');
    await dataSource.query(`UPDATE kyc_submissions SET deleted_at = now() WHERE id = $1`, [onlyId]);

    const res = await service.getWhitelistStatus(userId);
    expect(res.lastSubmissionAt).toBeNull();
  });

  it('404s when the user row does not exist', async () => {
    await expect(
      service.getWhitelistStatus('00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ status: 404, response: { errorCode: 'USER_NOT_FOUND' } });
  });

  it('CHK_users_kyc_status rejects a retired value (enum↔constraint coupling)', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO users (email, is_active, kyc_status) VALUES ($1, true, 'approved')`,
        ['bad@example.com'],
      ),
      // Assert the specific constraint (not just any error) so an unrelated INSERT failure can't pass this.
    ).rejects.toThrow(/CHK_users_kyc_status/); // 23514 check_violation — 'approved' is no longer valid at user level
  });
});
