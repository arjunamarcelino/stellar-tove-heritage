import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  INTERNAL_AUDIT_LOG_REPOSITORY,
  IInternalAuditLogRepository,
} from './repositories/internal-audit-log-repository.interface';
import { NewAuditEntry } from './audit-log.types';

/**
 * Thin seam over the append-only `internal_audit_log`. The export flow records a row at request,
 * submit, and confirmation; the confirm-time row is written inside the markExported transaction (pass
 * its `manager`) so the audit fact and the state change commit or roll back together. Audit failures on
 * the non-transactional paths are logged, never thrown — an audit hiccup must not fail a money action
 * that already succeeded on-chain.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @Inject(INTERNAL_AUDIT_LOG_REPOSITORY) private readonly repo: IInternalAuditLogRepository,
  ) {}

  /** Append an audit row. When `manager` is supplied the write is part of that transaction (errors propagate). */
  async record(entry: NewAuditEntry, manager?: EntityManager): Promise<void> {
    if (manager) {
      // Transactional: the caller wants atomicity with the audited side effect — let errors propagate.
      await this.repo.record(entry, manager);
      return;
    }
    try {
      await this.repo.record(entry);
    } catch (err) {
      this.logger.error(`failed to write audit row [kind=${entry.kind} subject=${entry.subjectId}]: ${String(err)}`);
    }
  }
}
