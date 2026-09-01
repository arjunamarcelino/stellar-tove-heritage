import { Entity, Column, BeforeInsert, BeforeUpdate } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { SocialLinks } from '@modules/users/profile/constants/social-links.constant';

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

  // KYC/whitelist lifecycle (TOV-28/TOV-29, FR-01.07/FR-01.08). `not_submitted` until the collector submits,
  // then `pending_review`; the M12 multi-sig flow later drives `whitelisted`/`frozen`/`removed`. varchar+CHECK
  // (native-enum-free, per house convention); the migration owns the CHECK.
  @Column({ name: 'kyc_status', type: 'varchar', length: 16, default: KycStatus.NOT_SUBMITTED })
  kycStatus!: KycStatus;

  // When the collector was whitelisted (TOV-29). Nullable; set only by the M12 transition flow. The read
  // endpoint gates this to status=whitelisted in the DTO — a stale value on a frozen row is never surfaced.
  @Column({ name: 'whitelisted_at', type: 'timestamptz', nullable: true })
  whitelistedAt: Date | null = null;

  // Machine-readable reason CODE for frozen/removed (TOV-29 R3), e.g. 'frozen_compliance_review'. NEVER raw
  // admin prose (that lives in internal_audit_log) — the client localizes the code. Nullable; M12-written.
  @Column({ name: 'kyc_reason', type: 'varchar', length: 256, nullable: true })
  kycReason: string | null = null;

  // Optional profile fields (TOV-30, FR-01.09). Trimmed + control-char-rejected in ProfileService; the
  // varchar lengths are the DB backstop. `social_links` is the first jsonb column on users (replace-whole-
  // object semantics; a DB CHECK asserts it is a json object). `profile_image_id` is the active avatar —
  // a raw-uuid FK (house convention, no @ManyToOne); the service nulls it on deactivate/soft-delete since
  // the ON DELETE SET NULL action never fires under TypeORM soft deletes.
  @Column({ name: 'bio', type: 'varchar', length: 300, nullable: true })
  bio: string | null = null;

  @Column({ name: 'statement', type: 'varchar', length: 500, nullable: true })
  statement: string | null = null;

  @Column({ name: 'social_links', type: 'jsonb', nullable: true })
  socialLinks: SocialLinks | null = null;

  @Column({ name: 'profile_image_id', type: 'uuid', nullable: true })
  profileImageId: string | null = null;

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
