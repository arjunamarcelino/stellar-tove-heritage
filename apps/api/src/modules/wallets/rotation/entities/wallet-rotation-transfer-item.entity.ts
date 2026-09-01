import { Entity, Column, ManyToOne, JoinColumn, Relation } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { WalletRotationItemStatus } from '../rotation-status.types';
import { ledgerNumberTransformer } from '../../ledger-number.transformer';
import { WalletRotationTransfer } from './wallet-rotation-transfer.entity';

/**
 * One FractionToken holding to move in a rotation: a single-token transfer of the source wallet's full
 * balance of `token_contract` to the destination (TOV-33). Each item is its own Soroban tx + passkey
 * signature (Soroban allows one op/tx), so the rotation is non-atomic and tracked per-item for resume +
 * partial-failure safety. The built (unsigned) tx + challenge are stored server-side so submit verifies the
 * assertion against the STORED tx, never the client's body. Mirrors {@link WalletExportItem} minus the
 * token-kind axis (rotation moves fractions only).
 */
@Entity('wallet_rotation_transfer_items')
export class WalletRotationTransferItem extends BaseEntity {
  @Column({ name: 'rotation_id', type: 'uuid' })
  rotationId!: string;

  @ManyToOne(() => WalletRotationTransfer, (rotation) => rotation.items)
  @JoinColumn({ name: 'rotation_id' })
  rotation!: Relation<WalletRotationTransfer>;

  @Column({ name: 'token_contract', type: 'varchar', length: 56 })
  tokenContract!: string;

  // Scaled i128 as a decimal string (frozen at initiate = the snapshot balance). DB CHECK: digits, non-zero.
  @Column({ name: 'amount_scaled', type: 'varchar', length: 40 })
  amountScaled!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: WalletRotationItemStatus;

  // The server-stored unsigned transfer + expiry (set at build; refreshed on resume). Submit verifies the
  // assertion against this stored tx. The WebAuthn challenge is NOT stored — responses always emit the fresh
  // challenge from the relayer build.
  @Column({ name: 'unsigned_tx_xdr', type: 'text', nullable: true })
  unsignedTxXdr!: string | null;

  @Column({ name: 'expires_at_ledger', type: 'bigint', nullable: true, transformer: ledgerNumberTransformer })
  expiresAtLedger!: number | null;

  // Set once confirmed on-chain (getTransaction == SUCCESS). tx_hash is unique among items (partial index);
  // a crash-reconciled item is confirmed with a null tx_hash (the hash was lost).
  @Column({ name: 'tx_hash', type: 'varchar', length: 64, nullable: true })
  txHash!: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: ledgerNumberTransformer })
  ledger!: number | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 48, nullable: true })
  lastErrorCode!: string | null;
}
