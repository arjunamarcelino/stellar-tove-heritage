import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../../setup';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { UsersModule } from '@modules/users/users.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { BeneficiaryModule } from '@modules/users/beneficiary/beneficiary.module';
import { BeneficiaryService } from '@modules/users/beneficiary/beneficiary.service';
import { BeneficiaryErasureService } from '@modules/users/beneficiary/beneficiary-erasure.service';
import { BeneficiaryErasureSweepService } from '@modules/users/beneficiary/erasure-sweep/beneficiary-erasure-sweep.service';
import { SetBeneficiaryDto } from '@modules/users/beneficiary/dto/set-beneficiary.dto';

// Drive the REAL BeneficiaryService + BeneficiaryErasureService (upsert + audit in one txn, hard-delete,
// KYC notice gating) against the real tove_test schema. UsersModule is imported wholesale (NOT a hand-rolled
// { provide: USER_REPOSITORY, useClass: UserRepository }) because UserRepository @Injects
// HANDLE_HISTORY_REPOSITORY — hand-rolling the token would break DI. WalletsAuditModule provides the real
// AuditLogService writing to internal_audit_log; BeneficiaryModule provides BENEFICIARY_REPOSITORY.
// BeneficiaryErasureSweepService only depends on BENEFICIARY_REPOSITORY, so it's provided directly here
// (without its BullMQ queue/processor/scheduler) to unit-test the reconcile query against the real DB.
@Module({
  imports: [UsersModule, WalletsAuditModule, BeneficiaryModule],
  providers: [BeneficiaryService, BeneficiaryErasureService, BeneficiaryErasureSweepService],
})
class TestBeneficiaryModule {}

interface BeneficiaryRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  stellar_pubkey: string | null;
  relationship: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface AuditRow {
  id: string;
  kind: string;
  subject_id: string;
  operation: string | null;
}

/** Extract a Postgres SQLSTATE code from an unknown thrown error (QueryFailedError carries `.code`). */
function pgCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code);
  }
  return undefined;
}

describe('Beneficiary designation (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: BeneficiaryService;
  let erasure: BeneficiaryErasureService;
  let sweep: BeneficiaryErasureSweepService;

  beforeAll(async () => {
    module = await createTestingModule(TestBeneficiaryModule);
    dataSource = module.get(DataSource);
    service = module.get(BeneficiaryService);
    erasure = module.get(BeneficiaryErasureService);
    sweep = module.get(BeneficiaryErasureSweepService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  /** Insert a user in a given whitelist state and return its id. */
  async function seedUser(email: string, kycStatus: KycStatus = KycStatus.NOT_SUBMITTED): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      `INSERT INTO users (email, is_active, kyc_status) VALUES ($1, true, $2) RETURNING id`,
      [email, kycStatus],
    );
    return rows[0].id;
  }

  /** The user's single beneficiary row (or null), read straight from the table. */
  async function readBeneficiary(userId: string): Promise<BeneficiaryRow | null> {
    const rows: BeneficiaryRow[] = await dataSource.query(
      `SELECT * FROM beneficiaries WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /** Audit rows for a given kind + subject (the beneficiary row id), with the payload operation projected. */
  async function auditRows(kind: string, subjectId: string): Promise<AuditRow[]> {
    return dataSource.query(
      `SELECT id, kind, subject_id, payload->>'operation' AS operation
         FROM internal_audit_log
        WHERE kind = $1 AND subject_id = $2
        ORDER BY created_at ASC`,
      [kind, subjectId],
    );
  }

  it('set (create): writes a beneficiaries row + a beneficiary.set/created audit row; NOT_SUBMITTED → KYC notice', async () => {
    const userId = await seedUser('create@example.com');
    const dto: SetBeneficiaryDto = { name: 'Jane Doe', email: 'Jane@Example.com' };

    const res = await service.setBeneficiary(userId, dto);

    const row = await readBeneficiary(userId);
    expect(row).not.toBeNull();
    expect(row?.name).toBe('Jane Doe');
    expect(row?.email).toBe('jane@example.com'); // lower-cased + trimmed by the service

    const audits = await auditRows('beneficiary.set', row!.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].operation).toBe('created');
    expect(audits[0].subject_id).toBe(row!.id);

    // Non-whitelisted collector → the KYC-required-for-transfer notice is attached.
    expect(res.notice?.code).toBe('KYC_REQUIRED_FOR_TRANSFER');
    expect(res.beneficiary?.id).toBe(row!.id);
  });

  it('update in place: same row id, updated_at advances, a second audit row with operation=updated', async () => {
    const userId = await seedUser('update@example.com');
    await service.setBeneficiary(userId, { name: 'Old Name', email: 'ben@example.com' });
    const before = await readBeneficiary(userId);

    await service.setBeneficiary(userId, { name: 'New Name', email: 'ben@example.com' });
    const after = await readBeneficiary(userId);

    expect(after?.id).toBe(before?.id); // updated in place, not re-created
    expect(after?.name).toBe('New Name');
    // Separate transactions → a later now(); @UpdateDateColumn advances the stamp.
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before!.updated_at).getTime());

    const audits = await auditRows('beneficiary.set', after!.id);
    expect(audits.map((a) => a.operation)).toEqual(['created', 'updated']);
  });

  it('full-replace clears an omitted optional: set with notes, then set without → notes IS NULL', async () => {
    const userId = await seedUser('replace@example.com');
    await service.setBeneficiary(userId, { name: 'Kin', email: 'kin@example.com', notes: 'primary heir' });
    expect((await readBeneficiary(userId))?.notes).toBe('primary heir');

    await service.setBeneficiary(userId, { name: 'Kin', email: 'kin@example.com' });
    expect((await readBeneficiary(userId))?.notes).toBeNull();
  });

  it('whitelisted collector → response notice is null', async () => {
    const userId = await seedUser('whitelisted@example.com', KycStatus.WHITELISTED);
    const res = await service.setBeneficiary(userId, { name: 'Heir', email: 'heir@example.com' });
    expect(res.notice).toBeNull();
    expect(res.beneficiary?.name).toBe('Heir');
  });

  it('delete: hard-removes the row + writes a beneficiary.removed audit row; second remove is an idempotent no-op', async () => {
    const userId = await seedUser('delete@example.com');
    await service.setBeneficiary(userId, { name: 'Gone', email: 'gone@example.com' });
    const created = await readBeneficiary(userId);

    await service.removeBeneficiary(userId);

    const [{ count }]: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM beneficiaries WHERE user_id = $1`,
      [userId],
    );
    expect(count).toBe(0); // HARD delete — no soft-deleted skeleton

    const removedAudits = await auditRows('beneficiary.removed', created!.id);
    expect(removedAudits).toHaveLength(1);
    expect(removedAudits[0].operation).toBe('removed');

    // Idempotent: removing again with nothing to remove neither throws nor changes the count.
    await expect(service.removeBeneficiary(userId)).resolves.toBeDefined();
    const [{ count: after }]: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM beneficiaries WHERE user_id = $1`,
      [userId],
    );
    expect(after).toBe(0);
  });

  it('re-designate after delete: set, remove, set again → a fresh row with a NEW id', async () => {
    const userId = await seedUser('redesignate@example.com');
    await service.setBeneficiary(userId, { name: 'First', email: 'first@example.com' });
    const first = await readBeneficiary(userId);

    await service.removeBeneficiary(userId);
    await service.setBeneficiary(userId, { name: 'Second', email: 'second@example.com' });
    const second = await readBeneficiary(userId);

    expect(second).not.toBeNull();
    expect(second?.name).toBe('Second');
    expect(second?.id).not.toBe(first?.id); // a brand-new row, not a resurrected one
  });

  it('one-active-row-per-user: a manual duplicate INSERT is rejected by UQ_beneficiaries_user_active (23505)', async () => {
    const userId = await seedUser('unique@example.com');
    await service.setBeneficiary(userId, { name: 'Only', email: 'only@example.com' });

    let code: string | undefined;
    try {
      await dataSource.query(
        `INSERT INTO beneficiaries (user_id, name, email) VALUES ($1, $2, $3)`,
        [userId, 'Duplicate', 'dup@example.com'],
      );
    } catch (err: unknown) {
      code = pgCode(err);
    }
    expect(code).toBe('23505'); // unique_violation on the partial-unique active index
  });

  it('hard-delete-only guard: a soft-delete UPDATE is rejected by the trigger (issue 420)', async () => {
    const userId = await seedUser('softdel@example.com');
    await service.setBeneficiary(userId, { name: 'NoSoft', email: 'nosoft@example.com' });
    const row = await readBeneficiary(userId);

    let message: string | undefined;
    try {
      await dataSource.query(`UPDATE beneficiaries SET deleted_at = now() WHERE id = $1`, [row?.id]);
    } catch (err: unknown) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/hard-delete only/);
    expect(await readBeneficiary(userId)).not.toBeNull(); // soft-delete blocked → row still active
  });

  it('BeneficiaryErasureService.purgeForUser hard-deletes the user beneficiary', async () => {
    const userId = await seedUser('erase@example.com');
    await service.setBeneficiary(userId, { name: 'ToErase', email: 'erase-ben@example.com' });
    expect(await readBeneficiary(userId)).not.toBeNull();

    await erasure.purgeForUser(userId);

    const [{ count }]: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM beneficiaries WHERE user_id = $1`,
      [userId],
    );
    expect(count).toBe(0);
  });

  it('erasure sweep (issue 418): purges beneficiaries whose owning user is soft-deleted, leaves live ones', async () => {
    const deletedUser = await seedUser('gone@example.com');
    const liveUser = await seedUser('here@example.com');
    await service.setBeneficiary(deletedUser, { name: 'Orphan', email: 'orphan@example.com' });
    await service.setBeneficiary(liveUser, { name: 'Kept', email: 'kept@example.com' });
    // Simulate a purge that never ran: soft-delete the user but leave the beneficiary behind.
    await dataSource.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [deletedUser]);

    const purged = await sweep.sweep();

    expect(purged).toBe(1);
    expect(await readBeneficiary(deletedUser)).toBeNull(); // orphan purged
    expect(await readBeneficiary(liveUser)).not.toBeNull(); // live user's beneficiary untouched
  });
});
