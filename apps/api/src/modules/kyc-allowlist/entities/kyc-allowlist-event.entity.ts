import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { KycAllowlistAction, KycAllowlistResultStatus } from '../kyc-allowlist.types';

/**
 * Append-only audit record of one on-chain KYC allowlist mutation attempt (TOV-235). Deliberately does NOT
 * extend BaseEntity: an immutable log has no `updated_at` (a lie on a write-once row) and no `deleted_at`.
 * Append-only is enforced at the DB layer by a BEFORE UPDATE OR DELETE trigger (migration). One row per
 * processed item per request; grouped by `batchId`. Distinct from the pre-existing `fraction_kyc_allowlist`
 * (TOV-40, off-chain export-destination list) — unrelated domain.
 */
@Entity('kyc_allowlist_events')
export class KycAllowlistEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Indexes (IDX_kae_batch, IDX_kae_wallet_created_at, BRIN) are created in the migration; the schema uses
  // synchronize:false so entity @Index decorators would be inert.
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  @Column({ type: 'char', length: 56 })
  wallet!: string;

  @Column({ type: 'varchar', length: 8 })
  action!: KycAllowlistAction;

  /** The backoffice admin's verified JWT `sub` (admins.id). */
  @Column({ name: 'admin_id', type: 'uuid' })
  adminId!: string;

  @Column({ name: 'tx_hash', type: 'char', length: 64, nullable: true })
  txHash!: string | null;

  /** Admin-supplied machine-readable code (`^[a-z0-9_]{1,64}$`), never prose. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  reason!: string | null;

  @Column({ type: 'varchar', length: 16 })
  result!: KycAllowlistResultStatus;

  /** Sanitized, bounded failure reason (single line) for `failed` items. */
  @Column({ name: 'error_reason', type: 'varchar', length: 500, nullable: true })
  errorReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
