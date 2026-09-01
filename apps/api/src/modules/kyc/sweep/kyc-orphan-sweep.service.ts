import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { kycConfig } from '@config/kyc.config';
import { KycDocument } from '../entities/kyc-document.entity';
import { IKycStorageService, KYC_STORAGE } from '../kyc.util';

export interface KycSweepResult {
  scanned: number;
  orphans: number;
  deleted: number;
}

/**
 * Orphan-blob reconciliation (review #193). Lists KYC bucket objects older than the grace window and
 * deletes those with NO `kyc_documents` row (crash-window leaks — a pod that died between upload and DB
 * commit). Compares against ALL document rows INCLUDING soft-deleted ones, since those blobs are retained.
 * Deletion is best-effort (the storage `delete` never throws); a stubborn object is retried next run.
 */
@Injectable()
export class KycOrphanSweepService {
  private readonly logger = new Logger(KycOrphanSweepService.name);

  constructor(
    @Inject(KYC_STORAGE) private readonly storage: IKycStorageService,
    @InjectRepository(KycDocument) private readonly documents: Repository<KycDocument>,
    @Inject(kycConfig.KEY) private readonly config: ConfigType<typeof kycConfig>,
  ) {}

  async sweep(): Promise<KycSweepResult> {
    const graceMs = this.config.orphanGraceHours * 60 * 60 * 1000;
    const candidates = await this.storage.listObjectsOlderThan('', graceMs);
    if (candidates.length === 0) {
      return { scanned: 0, orphans: 0, deleted: 0 };
    }

    // Known keys — include soft-deleted rows (their blobs are retained, not orphans).
    const rows = await this.documents.find({ withDeleted: true, select: { storageKey: true } });
    const known = new Set(rows.map((r) => r.storageKey));
    const orphans = candidates.filter((key) => !known.has(key));

    for (const key of orphans) {
      await this.storage.delete(key); // best-effort; logs on failure, never throws
    }
    if (orphans.length > 0) {
      this.logger.warn(
        `KYC orphan sweep: ${orphans.length} orphan object(s) deleted of ${candidates.length} scanned`,
      );
    }
    return { scanned: candidates.length, orphans: orphans.length, deleted: orphans.length };
  }
}
