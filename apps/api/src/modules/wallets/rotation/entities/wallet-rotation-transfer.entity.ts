import { Entity, Column, OneToMany, Relation } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { WalletRotationStatus } from '../rotation-status.types';
import { WalletRotationTransferItem } from './wallet-rotation-transfer-item.entity';

/**
 * A single in-flight (or completed) rotation of an embedded wallet's FractionToken holdings to the
 * Collector's own BYOW settlement wallet (TOV-33). Parent header for N per-token
 * {@link WalletRotationTransferItem}s (Soroban = one op/tx). At most one non-completed rotation per source
 * wallet (partial unique index). `destination_address` is frozen at first initiate — a resume reuses it,
 * and set-primary/remove of the destination mid-rotation never re-targets the transfer.
 *
 * Unlike export, completion does NOT latch the source wallet `exported`: rotation only moves holdings;
 * removing the old wallet is the separate `DELETE /me/wallets/:id`.
 */
@Entity('wallet_rotation_transfers')
export class WalletRotationTransfer extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Scalar FK columns only — the `@ManyToOne(() => Wallet)` relations were unused (never loaded) and dropped
  // (todo 434); the DB FK constraints live in migration 053.
  @Column({ name: 'source_wallet_id', type: 'uuid' })
  sourceWalletId!: string;

  @Column({ name: 'destination_wallet_id', type: 'uuid' })
  destinationWalletId!: string;

  // Frozen at first initiate (= the destination wallet's public key / G-address). The transfer pins `to` +
  // `expectedTo` to this; a resume ignores a differing body destination.
  @Column({ name: 'destination_address', type: 'varchar', length: 56 })
  destinationAddress!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: WalletRotationStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @OneToMany(() => WalletRotationTransferItem, (item) => item.rotation)
  items!: Relation<WalletRotationTransferItem[]>;
}
