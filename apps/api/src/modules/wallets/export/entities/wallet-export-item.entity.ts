import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { ExportTokenKind, WalletExportItemStatus } from '../export-status.types';
import { WalletExport } from './wallet-export.entity';

/**
 * bigint <-> number transformer for ledger sequences. A Soroban ledger sequence is far below 2^53, so
 * `Number()` is precision-safe here (unlike `amount_scaled`, which stays a BigInt decimal string).
 * Shared by both ledger columns.
 */
const ledgerNumberTransformer = {
  to: (v: number | null): number | null => v,
  from: (v: string | null): number | null => (v === null ? null : Number(v)),
};

/**
 * One holding to move in an export: a single-token transfer of the wallet's full balance of
 * `token_contract` (USDC SAC or a Soroban fraction) to the export target (TOV-40). Each item is its own
 * Soroban tx + passkey signature (Soroban allows one op/tx), so the drain is non-atomic and tracked
 * per-item for resume + partial-failure safety. The built (unsigned) tx + challenge are stored
 * server-side so submit verifies the assertion against the STORED tx, never the client's body.
 */
@Entity('wallet_export_items')
export class WalletExportItem extends BaseEntity {
  @Column({ name: 'export_id', type: 'uuid' })
  exportId!: string;

  @ManyToOne(() => WalletExport, (exp) => exp.items)
  @JoinColumn({ name: 'export_id' })
  export!: WalletExport;

  @Column({ name: 'token_contract', type: 'varchar', length: 56 })
  tokenContract!: string;

  @Column({ name: 'token_kind', type: 'varchar', length: 16 })
  tokenKind!: ExportTokenKind;

  // Scaled i128 as a decimal string (frozen at initiate = the snapshot balance). DB CHECK: digits, non-zero.
  @Column({ name: 'amount_scaled', type: 'varchar', length: 40 })
  amountScaled!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: WalletExportItemStatus;

  // The server-stored unsigned transfer + expiry (set at build; refreshed on resume). Submit verifies
  // the assertion against this stored tx. The WebAuthn challenge is NOT stored — responses always emit
  // the fresh challenge from the relayer build.
  @Column({ name: 'unsigned_tx_xdr', type: 'text', nullable: true })
  unsignedTxXdr!: string | null;

  @Column({ name: 'expires_at_ledger', type: 'bigint', nullable: true, transformer: ledgerNumberTransformer })
  expiresAtLedger!: number | null;

  // Set once confirmed on-chain (getTransaction == SUCCESS). tx_hash is unique among items (partial index).
  @Column({ name: 'tx_hash', type: 'varchar', length: 64, nullable: true })
  txHash!: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: ledgerNumberTransformer })
  ledger!: number | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 48, nullable: true })
  lastErrorCode!: string | null;
}
