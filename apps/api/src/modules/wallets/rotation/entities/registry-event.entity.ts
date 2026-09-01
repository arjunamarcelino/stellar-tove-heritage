import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ledgerNumberTransformer } from '../../ledger-number.transformer';

/** Registry event kinds. Only `custody_transfer` exists today (TOV-33). */
export type RegistryEventType = 'custody_transfer';

/**
 * Append-only on-chain provenance registry (TOV-33). One `custody_transfer` row per confirmed
 * FractionToken transfer during a wallet rotation. DELIBERATELY does NOT extend BaseEntity — it is an
 * immutable ledger (no `updated_at`, no `deleted_at`); a DB trigger (`trg_registry_events_guard`) rejects
 * UPDATE/DELETE — same append-only intent as `internal_audit_log`, using the newer `fn_/trg_`-prefixed guard
 * naming (rfqs/quotes convention), not that table's older `*_immutable` naming. Distinct from it: this keys on wallet
 * StrKey addresses (varchar, not the uuid `subject_id`) and carries the on-chain tx hash/ledger.
 *
 * `source_ref` (`rotation_item:{itemId}`) has a FULL unique index so a bare `ON CONFLICT (source_ref) DO
 * NOTHING` insert is idempotent under replay + crash-reconcile → exactly one row per confirmed transfer.
 */
@Entity('registry_events')
export class RegistryEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType!: RegistryEventType;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'source_wallet_id', type: 'uuid' })
  sourceWalletId!: string;

  @Column({ name: 'destination_wallet_id', type: 'uuid' })
  destinationWalletId!: string;

  @Column({ name: 'from_address', type: 'varchar', length: 56 })
  fromAddress!: string;

  @Column({ name: 'to_address', type: 'varchar', length: 56 })
  toAddress!: string;

  @Column({ name: 'token_contract', type: 'varchar', length: 56 })
  tokenContract!: string;

  // Scaled i128 as a decimal string (numeric(39,0) → string, bigint-safe). DB CHECK: > 0.
  @Column({ name: 'amount_scaled', type: 'numeric', precision: 39, scale: 0 })
  amountScaled!: string;

  // Null only for a true false-negative reconcile (balance drained but the hash was never recorded).
  @Column({ name: 'tx_hash', type: 'varchar', length: 64, nullable: true })
  txHash!: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: ledgerNumberTransformer })
  ledger!: number | null;

  // Dedup key = `rotation_item:{itemId}` — FULL unique so ON CONFLICT (source_ref) DO NOTHING infers it.
  @Column({ name: 'source_ref', type: 'varchar', length: 128 })
  sourceRef!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
