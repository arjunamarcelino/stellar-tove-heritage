import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { User } from '@modules/users/entities/user.entity';

/**
 * Two wallet kinds today:
 *  - 'byow'             — self-custodied bring-your-own-wallet; identified by `publicKey` (G-address).
 *  - 'embedded_passkey' — Soroban smart-wallet deployed from a passkey; identified by `contractAddress`
 *                         (C-address). Its passkey signer lives on `PasskeyCredential` (1:1).
 * The `kind` union, its CHECK, and the per-kind field-presence CHECK are widened together
 * (see migration 1716000000012). Add a new kind only alongside those constraints.
 */
export type WalletKind = 'byow' | 'embedded_passkey';

/** Wallet lifecycle vs. export (TOV-40). `exported` is terminal — the one-way export latch. */
export type WalletStatus = 'active' | 'exported';

@Entity('wallets')
export class Wallet extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Stellar StrKey (case-sensitive) -- stored as varchar, NOT citext.
  // Nullable: a Soroban smart wallet is a contract (C-address), not a G-address account,
  // so `embedded_passkey` wallets have a null public_key and use `contractAddress` instead.
  @Column({ name: 'public_key', type: 'varchar', length: 56, nullable: true })
  publicKey!: string | null;

  // Deployed Soroban contract address (C-StrKey) for `embedded_passkey` wallets; null for byow.
  @Column({ name: 'contract_address', type: 'varchar', length: 56, nullable: true })
  contractAddress!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'byow' })
  kind!: WalletKind;

  // Multi-wallet primary designation (TOV-24). Exactly one live wallet per user is primary
  // (enforced by partial unique index `UQ_wallets_primary_active`, WHERE is_primary AND deleted_at IS
  // NULL). The primary wallet is delete-protected; re-designation is owned by FR-01.04.
  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  // Export lifecycle (TOV-40). `status='exported'` + `removed_at` set together (DB CHECK), only when a
  // full export drains all holdings. Distinct from soft-delete `deleted_at`.
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: WalletStatus;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;
}
