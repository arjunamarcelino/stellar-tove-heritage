import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { User } from '../entities/user.entity';
import { IUserRepository } from './user-repository.interface';
import {
  HANDLE_HISTORY_REPOSITORY,
  IHandleHistoryRepository,
} from './handle-history-repository.interface';

@Injectable()
export class UserRepository extends BaseRepository<User> implements IUserRepository {
  constructor(
    dataSource: DataSource,
    @Inject(HANDLE_HISTORY_REPOSITORY) private readonly handleHistory: IHandleHistoryRepository,
  ) {
    super(User, dataSource);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { email: email.toLowerCase().trim() },
    });
  }

  findByHandleCanonical(canonical: string): Promise<User | null> {
    // TypeORM auto-appends `deleted_at IS NULL`, matching the partial unique index predicate so the
    // planner uses UQ_users_handle_canonical_active for this equality lookup.
    return this.repository.findOne({ where: { handleCanonical: canonical } });
  }

  findPublicProfileByHandleCanonical(canonical: string): Promise<User | null> {
    // Projected: only the public-profile fields load, so passwordHash/refreshTokenHash never hydrate for an
    // anonymous read (mirrors findHandleByUserId). `id` MUST be selected — an all-NULL projection returns
    // null for a matched row (PR #28 learning), and it's needed for the history lookup.
    return this.repository.findOne({
      where: { handleCanonical: canonical },
      select: { id: true, handle: true, handleCanonical: true, handleHistoryPublic: true, createdAt: true },
    });
  }

  async findHandleByUserId(userId: string): Promise<{ handle: string | null } | null> {
    // Projected: select only id + handle so secret columns (passwordHash/refreshTokenHash) never load.
    // `id` MUST be selected — with a handle-only projection TypeORM returns null for a row whose handle
    // is NULL (it can't tell an all-NULL projection from no row), which would 404 a handle-less user.
    const row = await this.repository.findOne({ where: { id: userId }, select: { id: true, handle: true } });
    return row ? { handle: row.handle } : null;
  }

  async setHandle(userId: string, handle: string): Promise<boolean> {
    // TOV-27: the handle UPDATE and the handle_history append must commit together (or not at all), so a
    // 23505/rollback never leaves an orphan history row. `manager.update` (like the old
    // `repository.update`) runs NO @BeforeUpdate hooks — safe here because the payload is `{ handle }` only
    // and those hooks guard email/passwordHash, not handle. The 23505 from the unique index propagates
    // unwrapped through runInTransaction (base.repository rethrows) to HandleService's catch → 409.
    return this.runInTransaction(async (manager) => {
      // `id` MUST be selected: a handle-only projection returns null for a NULL-handle row (TypeORM can't
      // tell an all-NULL projection from no row), which would false-negative a handle-less live user.
      // `FOR UPDATE` (pessimistic_write) locks the caller's own row so two concurrent same-user setHandle
      // calls serialize: the second re-reads the committed handle before computing `changed`, instead of
      // both snapshotting the stale pre-change value under READ COMMITTED (which would double-append or
      // write an inconsistent ledger). Cross-user calls lock different rows → no contention.
      const before = await manager.findOne(User, {
        where: { id: userId },
        select: { id: true, handle: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!before) return false; // no live user (soft-deleted/absent)
      // Append only on a REAL change (suppresses no-op / case-only re-sets → unbounded-growth guard).
      // JS toLowerCase() agrees with PG lower() because the handle is ASCII (format-validated upstream).
      const changed = (before.handle?.toLowerCase() ?? null) !== handle.toLowerCase();
      await manager.update(User, userId, { handle }); // may throw 23505 (canonical taken by a live user)
      // Append through the history repo (not a raw manager.insert) so the entity write flows through its
      // owning repository; the shared manager keeps it atomic with the UPDATE above.
      if (changed) await this.handleHistory.record(userId, handle, manager);
      return true;
    });
  }

  async setHistoryVisibility(userId: string, isPublic: boolean): Promise<boolean> {
    // Raw `repository.update()` (not BaseRepository.update/save) — one UPDATE, skips the @BeforeUpdate hooks
    // (they guard email/passwordHash, neither touched here) and the extra SELECT. Do not "fix" to save().
    const res = await this.repository.update(userId, { handleHistoryPublic: isPublic });
    return (res.affected ?? 0) > 0; // false ⇒ no live user (soft-deleted/absent)
  }
}
