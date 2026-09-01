import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { KycSubmission } from '../entities/kyc-submission.entity';

export const KYC_SUBMISSION_REPOSITORY = 'IKycSubmissionRepository';

export interface IKycSubmissionRepository extends IBaseRepository<KycSubmission> {
  /**
   * The caller's most-recent live submission (newest-first, index-covered) — backs the GET /me/kyc status
   * read and the resubmission `supersedes` lookup. Soft-delete-scoped (TypeORM auto-scopes
   * `deleted_at IS NULL`), so soft-deleting a submission severs it from a future supersession chain.
   */
  findLatestByUser(userId: string): Promise<KycSubmission | null>;
}
