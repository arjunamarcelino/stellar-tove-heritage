import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { KycSubmissionStatus } from '../enums/kyc-submission-status.enum';

/**
 * A KYC submission header (TOV-28, FR-01.07). One row per submit; the four encrypted documents live in
 * `kyc_documents`. Soft-deletable but NEVER hard-deleted — 7-year retention (the FK from `kyc_documents`
 * is `ON DELETE RESTRICT`). At most one `pending_review` row per user is enforced by the partial-unique
 * index `UQ_kyc_submissions_one_pending_per_user` (see migration …025).
 */
@Entity('kyc_submissions')
export class KycSubmission extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: KycSubmissionStatus;

  /** Normalized ISO-3166-1 alpha-2 (upper-case), validated against the config allowlist before insert. */
  @Column({ name: 'claimed_jurisdiction', type: 'char', length: 2 })
  claimedJurisdiction!: string;

  /** Links a resubmission to the prior (rejected) submission it supersedes (D6). Null on first submit. */
  @Column({ name: 'supersedes_submission_id', type: 'uuid', nullable: true })
  supersedesSubmissionId: string | null = null;
}
