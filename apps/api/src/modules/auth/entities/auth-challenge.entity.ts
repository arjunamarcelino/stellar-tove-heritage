import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Ephemeral SEP-10 challenge. Not a BaseEntity: no soft-delete -- rows are
 * single-use (consumed_at) and swept once past expires_at.
 */
@Entity('auth_challenges')
export class AuthChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Owner of a wallet-BIND challenge (TOV-24): stamped at issuance so verify can assert the caller owns
  // the challenge, blocking a leaked/misdirected signed XDR from binding a pubkey to another account.
  // NULL for anonymous LOGIN challenges (`auth/sep10/verify`). Indexed by a partial index in the migration.
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null = null;

  // Indexed by a PARTIAL index (WHERE consumed_at IS NULL) owned by the migration,
  // not a plain @Index() — the only public_key query filters to unconsumed rows.
  @Column({ name: 'public_key', type: 'varchar', length: 56 })
  publicKey!: string;

  // Stellar transaction hash (hex) of the issued challenge -- the single-use key.
  // The XDR itself isn't stored: verify re-parses the client-submitted signed XDR,
  // and tx_hash already binds the submission to the exact issued challenge.
  @Column({ name: 'tx_hash', type: 'varchar', length: 64, unique: true })
  txHash!: string;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null = null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
