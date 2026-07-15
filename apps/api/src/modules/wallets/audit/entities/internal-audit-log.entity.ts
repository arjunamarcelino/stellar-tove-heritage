import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { AuditActorType } from '../audit-log.types';

/**
 * Append-only internal audit ledger (TOV-40; forward-compatible with the TOV-124 export pipeline).
 * Deliberately does NOT extend BaseEntity: an immutable ledger must have no `updated_at` (a lie on a
 * write-once row) and no `deleted_at` (soft-delete would defeat auditability / AML value). Append-only
 * is also enforced at the grant level in ops (REVOKE UPDATE, DELETE) — see the migration note.
 */
@Entity('internal_audit_log')
export class InternalAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType!: AuditActorType;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  // Indexed (kind, created_at) + (subject_type, subject_id) + BRIN(created_at) in the migration.
  @Column({ type: 'varchar', length: 64 })
  kind!: string;

  @Column({ name: 'subject_type', type: 'varchar', length: 32 })
  subjectType!: string;

  @Column({ name: 'subject_id', type: 'uuid' })
  subjectId!: string;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
