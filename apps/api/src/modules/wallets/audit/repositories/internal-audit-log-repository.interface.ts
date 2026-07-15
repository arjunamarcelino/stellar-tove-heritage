import { EntityManager } from 'typeorm';
import { NewAuditEntry } from '../audit-log.types';

export const INTERNAL_AUDIT_LOG_REPOSITORY = 'IInternalAuditLogRepository';

export interface IInternalAuditLogRepository {
  /**
   * Append one audit row. Accepts an optional `EntityManager` so a confirm-time audit row can be
   * written inside the SAME transaction that flips the wallet to exported (atomic with the side effect).
   */
  record(entry: NewAuditEntry, manager?: EntityManager): Promise<void>;
}
