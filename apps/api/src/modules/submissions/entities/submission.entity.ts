import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { SubmissionStatus } from '@common/enums/submission-status.enum';

@Entity('submissions')
export class Submission extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'mission_id', type: 'uuid' })
  missionId!: string;

  @Column({ name: 'status', type: 'varchar', length: 32, default: SubmissionStatus.PENDING })
  status!: SubmissionStatus;

  @Column({ name: 'file_url', type: 'varchar', length: 512, nullable: true })
  fileUrl!: string | null;

  @Column({ name: 'link_url', type: 'varchar', length: 2048, nullable: true })
  linkUrl!: string | null;

  @Column({ name: 'text_content', type: 'text', nullable: true })
  textContent!: string | null;

  @Column({ name: 'admin_notes', type: 'text', nullable: true })
  adminNotes!: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
}
