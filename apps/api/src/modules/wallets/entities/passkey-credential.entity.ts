import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { Wallet } from './wallet.entity';

/**
 * The WebAuthn passkey bound to an embedded smart wallet (1:1 with `Wallet`).
 * Part of the wallet aggregate (owned by the wallets domain), not the auth
 * ceremony. Persistent + soft-deletable (extends BaseEntity).
 */
@Entity('passkey_credentials')
export class PasskeyCredential extends BaseEntity {
  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'wallet_id' })
  wallet!: Wallet;

  // WebAuthn credential id (base64url). Globally unique (partial index over live rows).
  @Column({ name: 'credential_id', type: 'text' })
  credentialId!: string;

  // COSE-encoded public key bytes (raw), stored as bytea -> Buffer.
  @Column({ name: 'public_key', type: 'bytea' })
  publicKey!: Buffer;

  // WebAuthn signature counter (uint32). bigint column, mapped to a JS number via
  // a transformer (uint32 is Number-safe). NOTE: 0 is normal for platform passkeys —
  // the future authenticate flow must not treat a 0/0 counter as a cloned credential.
  @Column({
    type: 'bigint',
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string): number => Number(v) },
  })
  counter!: number;

  // Comma-joined AuthenticatorTransportFuture[] (e.g. "internal,hybrid"); nullable.
  @Column({ type: 'text', nullable: true })
  transports: string | null = null;
}
