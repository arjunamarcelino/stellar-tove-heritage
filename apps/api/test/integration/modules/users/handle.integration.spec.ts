import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { User } from '@modules/users/entities/user.entity';
import { HandleHistory } from '@modules/users/entities/handle-history.entity';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { USER_REPOSITORY } from '@modules/users/repositories/user-repository.interface';
import { HandleHistoryRepository } from '@modules/users/repositories/handle-history.repository';
import { HANDLE_HISTORY_REPOSITORY } from '@modules/users/repositories/handle-history-repository.interface';
import { HandleService } from '@modules/users/handle/handle.service';
import { isUniqueConstraintError } from '@common/utils/database.utils';

// setHandle appends a handle_history row (via the history repo) in the same transaction (TOV-27), so both
// the entity and the HANDLE_HISTORY_REPOSITORY provider must be registered.
@Module({
  imports: [TypeOrmModule.forFeature([User, HandleHistory])],
  providers: [
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: HANDLE_HISTORY_REPOSITORY, useClass: HandleHistoryRepository },
    HandleService,
  ],
})
class TestHandleModule {}

describe('Handle Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: HandleService;
  let repo: Repository<User>;

  /** Insert a bare collector row (SEP-10 users have null email/password) and return its id. */
  async function makeUser(): Promise<string> {
    const user = repo.create({});
    const saved = await repo.save(user);
    return saved.id;
  }

  beforeAll(async () => {
    module = await createTestingModule(TestHandleModule);
    dataSource = module.get(DataSource);
    service = module.get(HandleService);
    repo = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  it('writes handle + DB-generated lowercase canonical, and looks it up case-insensitively', async () => {
    const id = await makeUser();
    const res = await service.setHandle(id, 'Maya');
    expect(res).toEqual({ handle: 'Maya', handleCanonical: 'maya' });

    const row = await repo.findOne({ where: { id } });
    expect(row?.handle).toBe('Maya');
    expect(row?.handleCanonical).toBe('maya'); // generated column

    const found = await repo.findOne({ where: { handleCanonical: 'maya' } });
    expect(found?.id).toBe(id);
  });

  it('uses the partial unique index for the canonical lookup (EXPLAIN, no seq scan)', async () => {
    const id = await makeUser();
    await service.setHandle(id, 'maya');
    const plan: Array<Record<string, string>> = await repo.query(
      `EXPLAIN SELECT id FROM users WHERE handle_canonical = 'maya' AND deleted_at IS NULL`,
    );
    const text = plan.map((r) => Object.values(r)[0]).join('\n');
    expect(text).toContain('UQ_users_handle_canonical_active');
    expect(text).not.toContain('Seq Scan');
  });

  it('blocks a second collector from claiming the same canonical (AC1, case-insensitive)', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await service.setHandle(a, 'Maya');
    await expect(service.setHandle(b, 'MAYA')).rejects.toMatchObject({
      response: { errorCode: 'HANDLE_TAKEN' },
    });
  });

  it('serializes concurrent claims — exactly one wins, one 409 (AC2)', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const results = await Promise.allSettled([
      service.setHandle(a, 'maya'),
      service.setHandle(b, 'maya'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      response: { errorCode: 'HANDLE_TAKEN' },
    });
  });

  it('idempotent self-reset — re-setting own handle (new casing) is 200, no 409 (AC5)', async () => {
    const id = await makeUser();
    await service.setHandle(id, 'maya');
    const res = await service.setHandle(id, 'MAYA'); // same owner, same canonical
    expect(res).toEqual({ handle: 'MAYA', handleCanonical: 'maya' });
    const row = await repo.findOne({ where: { id } });
    expect(row?.handle).toBe('MAYA'); // casing follows last write
  });

  it('releases the handle on soft-delete so another collector can claim it (AC15)', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await service.setHandle(a, 'maya');
    await repo.softDelete(a);
    const res = await service.setHandle(b, 'maya');
    expect(res.handleCanonical).toBe('maya');
  });

  it('restore invariant: restoring a soft-deleted holder whose handle was re-claimed raises 23505 (AC16)', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await service.setHandle(a, 'maya');
    await repo.softDelete(a);
    await service.setHandle(b, 'maya');
    // Restoring A now collides with B's live 'maya' on the partial unique index.
    let err: unknown;
    try {
      await repo.restore(a);
    } catch (e) {
      err = e;
    }
    expect(isUniqueConstraintError(err)).toBe(true);
  });

  it('rejects reserved words (422 HANDLE_RESERVED) before touching the DB (AC4)', async () => {
    const id = await makeUser();
    await expect(service.setHandle(id, 'admin')).rejects.toMatchObject({
      response: { errorCode: 'HANDLE_RESERVED' },
    });
  });

  it('rejects invalid formats (422 HANDLE_FORMAT_INVALID) (AC3)', async () => {
    const id = await makeUser();
    await expect(service.setHandle(id, 'ma ya')).rejects.toMatchObject({
      response: { errorCode: 'HANDLE_FORMAT_INVALID' },
    });
  });

  describe('check()', () => {
    it('reports available for a free, valid handle', async () => {
      expect(await service.check('freehandle')).toEqual({ handle: 'freehandle', available: true });
    });

    it('reports taken case-insensitively (AC14)', async () => {
      const a = await makeUser();
      await service.setHandle(a, 'Maya');
      expect(await service.check('MAYA')).toEqual({ handle: 'MAYA', available: false, reason: 'taken' });
    });

    it('reports reserved / invalid_format without a DB hit', async () => {
      expect(await service.check('admin')).toEqual({ handle: 'admin', available: false, reason: 'reserved' });
      expect(await service.check('ma ya')).toEqual({ handle: 'ma ya', available: false, reason: 'invalid_format' });
    });

    it('precedence: reserved-and-invalid resolves to invalid_format (AC7)', async () => {
      expect(await service.check('Admin!')).toEqual({ handle: 'Admin!', available: false, reason: 'invalid_format' });
    });
  });
});
