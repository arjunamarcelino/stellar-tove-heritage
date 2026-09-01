import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { KycAllowlistAction } from '../kyc-allowlist.types';

/**
 * Advisory, NON-authoritative mirror of the on-chain `is_allowed(wallet)` state (TOV-235). The chain is the
 * source of truth; nothing gates spendability on this row. Keyed by the wallet StrKey (natural PK — exactly
 * one state per wallet, no other table FKs to it). Refreshed (last-write-wins) on confirmed submissions,
 * which are serialized under the account lock in ledger order. No `deleted_at`: removal sets
 * `is_allowed=false`, keeping the row.
 */
@Entity('kyc_allowlist_state')
export class KycAllowlistState {
  @PrimaryColumn({ type: 'char', length: 56 })
  wallet!: string;

  @Column({ name: 'is_allowed', type: 'boolean' })
  isAllowed!: boolean;

  @Column({ name: 'last_action', type: 'varchar', length: 8 })
  lastAction!: KycAllowlistAction;

  @Column({ name: 'last_tx_hash', type: 'char', length: 64, nullable: true })
  lastTxHash!: string | null;

  /** Ledger sequence of the last applied mutation — the monotonic-forward upsert guard. numeric → string. */
  @Column({ name: 'last_ledger', type: 'bigint', nullable: true })
  lastLedger!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
