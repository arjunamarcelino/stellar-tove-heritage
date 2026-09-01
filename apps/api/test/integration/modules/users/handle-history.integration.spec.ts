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
import { CollectorsService } from '@modules/collectors/collectors.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, HandleHistory])],
  providers: [
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: HANDLE_HISTORY_REPOSITORY, useClass: HandleHistoryRepository },
    HandleService,
    CollectorsService,
  ],
})
class TestHandleHistoryModule {}

describe('Handle History Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let handles: HandleService;
  let collectors: CollectorsService;
  let users: Repository<User>;
  let history: Repository<HandleHistory>;

  async function makeUser(): Promise<string> {
    const saved = await users.save(users.create({}));
    return saved.id;
  }

  const countHistory = (userId: string) => history.count({ where: { userId } });

  beforeAll(async () => {
    module = await createTestingModule(TestHandleHistoryModule);
    dataSource = module.get(DataSource);
    handles = module.get(HandleService);
    collectors = module.get(CollectorsService);
    users = dataSource.getRepository(User);
    history = dataSource.getRepository(HandleHistory);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  describe('setHandle append semantics (atomic with the users update)', () => {
    it('appends the new handle on the first set and on every real change (N changes → N rows, time-ordered)', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'first');
      await handles.setHandle(id, 'second');
      await handles.setHandle(id, 'third');
      const rows = await history.find({ where: { userId: id }, order: { createdAt: 'ASC' } });
      expect(rows.map((r) => r.handle)).toEqual(['first', 'second', 'third']);
      expect(rows.map((r) => r.handleCanonical)).toEqual(['first', 'second', 'third']); // generated column
    });

    it('does NOT append on a no-op or case-only re-set (canonical unchanged)', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'maya'); // 1 row
      await handles.setHandle(id, 'maya'); // no-op
      await handles.setHandle(id, 'MAYA'); // case-only change → display updates, no new row
      expect(await countHistory(id)).toBe(1);
      expect((await users.findOne({ where: { id } }))?.handle).toBe('MAYA'); // display follows last write
    });

    it('is atomic: a 23505 on the handle update appends no history row and does not change the handle', async () => {
      const a = await makeUser();
      const b = await makeUser();
      await handles.setHandle(b, 'taken');
      await handles.setHandle(a, 'other'); // A now has 1 history row + handle 'other'
      await expect(handles.setHandle(a, 'taken')).rejects.toMatchObject({
        response: { errorCode: 'HANDLE_TAKEN' },
      });
      expect(await countHistory(a)).toBe(1); // rolled back — no orphan row
      expect((await users.findOne({ where: { id: a } }))?.handle).toBe('other'); // unchanged
    });

    it('serializes concurrent same-user setHandle (FOR UPDATE): a duplicate value appends only one row', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'first'); // 1 row
      // Two concurrent calls setting the SAME new handle. The pessimistic_write lock forces the second
      // transaction to re-read the committed 'second' before computing `changed`, so its no-op append is
      // suppressed → exactly one new row. Without the lock both snapshot 'first' and each append 'second' (2).
      await Promise.all([handles.setHandle(id, 'second'), handles.setHandle(id, 'second')]);
      expect(await countHistory(id)).toBe(2); // first + a single 'second', not first + second + second
      const rows = await history.find({ where: { userId: id }, order: { createdAt: 'ASC' } });
      expect(rows.map((r) => r.handle)).toEqual(['first', 'second']);
    });
  });

  describe('CollectorsService read', () => {
    it('returns deduped previous handles newest-first, excluding the current one', async () => {
      const id = await makeUser();
      // Insert history directly with explicit timestamps for a deterministic ordering assertion.
      const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
      await history.insert([
        { userId: id, handle: 'alice', createdAt: at(1) },
        { userId: id, handle: 'bob', createdAt: at(2) },
        { userId: id, handle: 'alice', createdAt: at(3) },
        { userId: id, handle: 'carol', createdAt: at(4) },
      ]);
      await users.update(id, { handle: 'carol' });
      const profile = await collectors.getProfile('CAROL'); // case-insensitive
      expect(profile.handle).toBe('carol');
      expect(profile.previousHandles).toEqual(['alice', 'bob']);
      expect(profile.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); // member-since date only (todo 179)
    });

    it('suppresses previous handles when the collector opted out', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'first');
      await handles.setHandle(id, 'second');
      await users.update(id, { handleHistoryPublic: false });
      const profile = await collectors.getProfile('second');
      expect(profile.previousHandles).toEqual([]);
    });

    it('404s a soft-deleted collector (current lookup is scoped to live rows)', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'ghost');
      await users.softDelete(id);
      await expect(collectors.getProfile('ghost')).rejects.toMatchObject({
        response: { errorCode: 'COLLECTOR_NOT_FOUND' },
      });
    });
  });

  describe('append-only + backfill hardening', () => {
    it('rejects a direct UPDATE on handle_history (immutability trigger)', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'frozen');
      await expect(
        history.query(`UPDATE handle_history SET handle = 'tampered' WHERE user_id = $1`, [id]),
      ).rejects.toThrow(/append-only/i);
    });

    it('backfill INSERT…SELECT is idempotent (WHERE NOT EXISTS)', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'seed'); // 1 row already
      await history.query(`
        INSERT INTO handle_history ("user_id", "handle", "created_at")
          SELECT u."id", u."handle", now() FROM "users" u
          WHERE u."handle" IS NOT NULL AND u."deleted_at" IS NULL
            AND NOT EXISTS (SELECT 1 FROM handle_history h WHERE h."user_id" = u."id")
      `);
      expect(await countHistory(id)).toBe(1); // no duplicate inserted
    });

    it('serves the per-user read from IDX_handle_history_user_created — index supplies created_at DESC order', async () => {
      const id = await makeUser();
      await handles.setHandle(id, 'indexed');
      // SET LOCAL (auto-reset at commit) removes the tiny-table Seq/Bitmap-Scan preference so the plan
      // reflects whether the index is USABLE and ordered.
      const explain = (sql: string) =>
        dataSource.transaction(async (m) => {
          await m.query('SET LOCAL enable_seqscan = off');
          await m.query('SET LOCAL enable_bitmapscan = off');
          const plan: Array<Record<string, string>> = await m.query(sql, [id]);
          return plan.map((r) => Object.values(r)[0]).join('\n');
        });

      // The actual repo read (`created_at DESC`, no id tiebreak): the index serves both the filter AND the
      // order — index used, no Seq Scan, and NO Sort node (the index supplies created_at DESC directly).
      const plan = await explain(
        `EXPLAIN SELECT id FROM handle_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      );
      expect(plan).toContain('IDX_handle_history_user_created');
      expect(plan).not.toContain('Seq Scan');
      expect(plan).not.toContain('Sort');
    });
  });
});
