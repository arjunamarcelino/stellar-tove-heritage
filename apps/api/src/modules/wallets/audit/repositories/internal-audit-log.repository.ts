import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { InternalAuditLog } from '../entities/internal-audit-log.entity';
import { NewAuditEntry } from '../audit-log.types';
import { IInternalAuditLogRepository } from './internal-audit-log-repository.interface';

@Injectable()
export class InternalAuditLogRepository
  extends BaseRepository<InternalAuditLog>
  implements IInternalAuditLogRepository
{
  constructor(dataSource: DataSource) {
    super(InternalAuditLog, dataSource);
  }

  async record(entry: NewAuditEntry, manager?: EntityManager): Promise<void> {
    // Use the caller's transactional manager when provided so the row commits atomically with the
    // side effect it audits; otherwise the default (auto-commit) repository.
    const repo = manager ? manager.getRepository(InternalAuditLog) : this.repository;
    const row = repo.create({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      kind: entry.kind,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      payload: entry.payload ?? null,
    });
    await repo.save(row);
  }
}
