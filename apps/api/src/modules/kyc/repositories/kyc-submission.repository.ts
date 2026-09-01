import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { KycSubmission } from '../entities/kyc-submission.entity';
import { IKycSubmissionRepository } from './kyc-submission-repository.interface';

@Injectable()
export class KycSubmissionRepository
  extends BaseRepository<KycSubmission>
  implements IKycSubmissionRepository
{
  constructor(dataSource: DataSource) {
    super(KycSubmission, dataSource);
  }

  /**
   * Newest submission for a user, or null. Relies on `findOne`'s IMPLICIT soft-delete filter
   * (`deleted_at IS NULL`, auto-appended for the `@DeleteDateColumn` entity) — a switch to
   * `createQueryBuilder` would NOT auto-filter and would leak soft-deleted rows into callers like the
   * status card's `lastSubmissionAt`. Callers must also gate on user existence (this query is user-agnostic).
   */
  async findLatestByUser(userId: string): Promise<KycSubmission | null> {
    return this.repository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}
