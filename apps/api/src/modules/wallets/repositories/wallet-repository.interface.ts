import { EntityManager } from 'typeorm';
import { Wallet } from '../entities/wallet.entity';

export const WALLET_REPOSITORY = 'IWalletRepository';

export interface IWalletRepository {
  /** Look up an ACTIVE wallet by its Stellar public key, with the bound user loaded. */
  findByPublicKey(publicKey: string): Promise<Wallet | null>;
  /**
   * Of the given Stellar public keys, the subset that is a LIVE BYOW wallet binding (soft-deleted excluded).
   * One `IN (…)` query, no relations hydrated — the TOV-243 advisory external-wallet check. `public_key` is
   * set only on `byow` rows, so a match is intrinsically byow-scoped.
   */
  findActiveByowPublicKeysIn(publicKeys: string[]): Promise<string[]>;
  /** Look up the caller's ACTIVE embedded-passkey wallet by user id (live rows only). */
  findEmbeddedWalletByUserId(userId: string): Promise<Wallet | null>;
  /** All LIVE wallets owned by a user (oldest first) — the `GET /me/wallets` list. */
  findAllByUserId(userId: string): Promise<Wallet[]>;
  /** Look up a wallet including soft-deleted rows (for reactivation on re-auth). */
  findAnyByPublicKey(publicKey: string): Promise<Wallet | null>;
  /** Clear `deleted_at`, reactivating a previously soft-deleted wallet. */
  restore(wallet: Wallet): Promise<Wallet>;
  /** Look up a LIVE wallet by id owned by `userId` (any status) — the export owner-scope guard (TOV-40). */
  findOwnedById(walletId: string, userId: string): Promise<Wallet | null>;
  /** Soft-delete a wallet (sets `deleted_at`), freeing its public_key for a future re-bind (TOV-24). */
  softRemove(wallet: Wallet): Promise<Wallet>;
  /**
   * Flip a wallet to the terminal `exported` state (status + removed_at together) within the caller's
   * transaction, but only from `active` and only if it exists — returns whether a row was updated.
   */
  markExported(walletId: string, manager: EntityManager): Promise<boolean>;
}
