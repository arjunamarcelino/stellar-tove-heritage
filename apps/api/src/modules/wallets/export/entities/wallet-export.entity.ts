import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { Wallet } from '../../entities/wallet.entity';
import { WalletExportStatus } from '../export-status.types';
import { WalletExportItem } from './wallet-export-item.entity';

/**
 * A single in-flight (or completed) export of an embedded wallet's holdings to a self-custody address
 * (TOV-40). Parent header for N per-holding {@link WalletExportItem}s. At most one non-completed export
 * per wallet (partial unique index). `target_address` is frozen at first initiate.
 */
@Entity('wallet_exports')
export class WalletExport extends BaseEntity {
  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'wallet_id' })
  wallet!: Wallet;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Frozen at first initiate; a resume ignores a differing body target.
  @Column({ name: 'target_address', type: 'varchar', length: 56 })
  targetAddress!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: WalletExportStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @OneToMany(() => WalletExportItem, (item) => item.export)
  items!: WalletExportItem[];
}
