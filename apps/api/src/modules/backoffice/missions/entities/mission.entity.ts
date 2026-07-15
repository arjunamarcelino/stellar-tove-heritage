import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { EvidenceType } from '@common/enums/evidence-type.enum';
import { VerificationMethod } from '@common/enums/verification-method.enum';

export interface SocialFollowConfig {
  targetUsername: string;
}

export type VerificationConfig = SocialFollowConfig;

@Entity('missions')
export class Mission extends BaseEntity {
  @Column({ name: 'stage_id', type: 'uuid' })
  stageId!: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'order', type: 'integer' })
  order!: number;

  @Column({ name: 'evidence_type', type: 'varchar', length: 32 })
  evidenceType!: EvidenceType;

  @Column({ name: 'verification_method', type: 'varchar', length: 64, default: VerificationMethod.MANUAL })
  verificationMethod!: VerificationMethod;

  @Column({ name: 'verification_config', type: 'jsonb', nullable: true })
  verificationConfig!: VerificationConfig | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
