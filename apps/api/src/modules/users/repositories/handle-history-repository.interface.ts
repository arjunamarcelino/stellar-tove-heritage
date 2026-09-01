import { EntityManager } from 'typeorm';
import { HandleHistory } from '../entities/handle-history.entity';

/**
 * DI token for {@link IHandleHistoryRepository}. String-const form, matching {@link USER_REPOSITORY}
 * (`user-repository.interface.ts`).
 */
export const HANDLE_HISTORY_REPOSITORY = 'IHandleHistoryRepository';

export interface IHandleHistoryRepository {
  /**
   * Every history row for a collector, newest-first, capped at the 50 most-recent — bounds the public
   * read even under adversarial rename oscillation. The caller dedups by canonical and excludes the
   * current handle.
   */
  listByUserId(userId: string): Promise<HandleHistory[]>;

  /**
   * Appends one history row. Pass the caller's transactional `manager` so the row commits atomically with
   * the `users.handle` update it records (mirrors `InternalAuditLogRepository.record`). `handle_canonical`
   * is DB-generated.
   */
  record(userId: string, handle: string, manager?: EntityManager): Promise<void>;
}
