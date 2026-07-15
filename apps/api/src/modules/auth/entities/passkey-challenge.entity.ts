import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Ephemeral WebAuthn registration challenge (embedded passkey). Not a BaseEntity:
 * no soft-delete -- rows are single-use (consumed_at) and swept once past expires_at.
 * Mirrors `AuthChallenge` (SEP-10). The `email` + `challenge` uniqueness/partial
 * indexes are owned by the migration.
 */
@Entity('passkey_challenges')
export class PasskeyChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Normalized (lower-cased) email the registration is for. citext for
  // case-insensitive equality/uniqueness with `users.email`.
  @Column({ type: 'citext' })
  email!: string;

  // base64url WebAuthn challenge (the single-use key). verify re-derives the
  // client challenge from clientDataJSON and looks the row up by this value.
  @Column({ type: 'text', unique: true })
  challenge!: string;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null = null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
