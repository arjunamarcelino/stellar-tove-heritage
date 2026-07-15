import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalAuditLog } from './entities/internal-audit-log.entity';
import { INTERNAL_AUDIT_LOG_REPOSITORY } from './repositories/internal-audit-log-repository.interface';
import { InternalAuditLogRepository } from './repositories/internal-audit-log.repository';
import { AuditLogService } from './audit-log.service';

/**
 * Neutral append-only audit facility (extracted from the export module — TOV-25 #158/#166). Owns the
 * `internal_audit_log` entity + repo + {@link AuditLogService}, so any wallet surface can record rows without
 * depending on the export module: the export lifecycle (TOV-40), the `me/` primary-change surface (TOV-25),
 * and first-designation genesis rows emitted by the neutral `WalletsService`. Imported by `WalletsModule`,
 * `WalletExportModule`, and `PublicMeWalletsModule`; imports nothing from them (no cycle).
 */
@Module({
  imports: [TypeOrmModule.forFeature([InternalAuditLog])],
  providers: [
    AuditLogService,
    { provide: INTERNAL_AUDIT_LOG_REPOSITORY, useClass: InternalAuditLogRepository },
  ],
  exports: [AuditLogService],
})
export class WalletsAuditModule {}
