import { Entity, Column, BeforeInsert, BeforeUpdate } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

@Entity('users')
export class User extends BaseEntity {
  // Nullable: BYOW wallet-only users have no email/password (SEP-10 login).
  @Column({ type: 'citext', nullable: true })
  email: string | null = null;

  @Column({ name: 'password_hash', type: 'varchar', length: 72, nullable: true })
  passwordHash: string | null = null;

  @Column({ name: 'first_name', type: 'varchar', nullable: true })
  firstName: string | null = null;

  @Column({ name: 'last_name', type: 'varchar', nullable: true })
  lastName: string | null = null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 64, nullable: true })
  refreshTokenHash: string | null = null;

  // Pseudonymous public handle (TOV-26, FR-01.05). Collector-typed display casing; nullable until claimed.
  @Column({ type: 'varchar', length: 24, nullable: true })
  handle: string | null = null;

  // DB-GENERATED (`GENERATED ALWAYS AS (lower(handle)) STORED`, see migration …023). TypeORM has no
  // metadata for generated columns, so this is modelled as a plain read-only `text` column:
  // insert/update:false stops TypeORM ever writing it (Postgres rejects writes to a generated column),
  // select stays true so we can read/query it. Do NOT add generatedType/asExpression — migrations own
  // the DDL. NOTE: `yarn migration:generate` will perpetually report drift here (it can't see the
  // GENERATED clause); discard that diff. After update({ handle }), this is stale in-memory — the
  // service computes the response canonical as handle.toLowerCase() rather than reading it back.
  @Column({ name: 'handle_canonical', type: 'text', nullable: true, insert: false, update: false })
  handleCanonical: string | null = null;

  // Whether this collector's handle history is shown on the public profile (TOV-27, FR-01.06).
  // Default true = the AC's public "previously known as" trail; set false to suppress previous_handles.
  @Column({ name: 'handle_history_public', type: 'boolean', default: true })
  handleHistoryPublic!: boolean;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeEmail(): void {
    if (this.email) {
      this.email = this.email.toLowerCase().trim();
    }
  }

  @BeforeInsert()
  @BeforeUpdate()
  validatePasswordHash(): void {
    if (this.passwordHash && !this.passwordHash.startsWith('$2')) {
      throw new Error('passwordHash must be a bcrypt hash, not a plain-text password');
    }
  }
}
