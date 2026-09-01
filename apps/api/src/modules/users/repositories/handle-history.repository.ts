import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { HandleHistory } from '../entities/handle-history.entity';
import { IHandleHistoryRepository } from './handle-history-repository.interface';

/**
 * Read side of the append-only handle history (TOV-27). Append happens transactionally inside
 * `UserRepository.setHandle`, so this repo only reads.
 *
 * ⚠️ APPEND-ONLY: the inherited `BaseRepository` mutators (`update`, `save`, `softRemove`) must NEVER be
 * used here — the table has no `updated_at`/`deleted_at` and a DB trigger forbids UPDATE. Injection is via
 * the `HANDLE_HISTORY_REPOSITORY` token narrowed to `IHandleHistoryRepository` (only `listByUserId`), so
 * callers cannot reach them.
 */
@Injectable()
export class HandleHistoryRepository
  extends BaseRepository<HandleHistory>
  implements IHandleHistoryRepository
{
  constructor(dataSource: DataSource) {
    super(HandleHistory, dataSource);
  }

  listByUserId(userId: string): Promise<HandleHistory[]> {
    return this.repository.find({
      where: { userId },
      // `created_at DESC` alone is served directly by IDX_handle_history_user_created (no Sort node). No
      // `id` tiebreak: a single collector can't produce two rows in the same instant, and the caller
      // dedups by canonical so any same-timestamp tie order is irrelevant to `previousHandles`.
      order: { createdAt: 'DESC' },
      take: 50, // cap: previous_handles never needs to be exhaustive; bounds oscillation abuse
    });
  }

  async record(userId: string, handle: string, manager?: EntityManager): Promise<void> {
    // Use the caller's transactional manager when provided so the row commits atomically with the
    // users.handle update it records; `insert` skips hooks + generated-column hydration (see entity doc).
    const repo = manager ? manager.getRepository(HandleHistory) : this.repository;
    await repo.insert({ userId, handle });
  }
}
