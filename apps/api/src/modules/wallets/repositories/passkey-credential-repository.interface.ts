import { PasskeyCredential } from '../entities/passkey-credential.entity';

export const PASSKEY_CREDENTIAL_REPOSITORY = 'IPasskeyCredentialRepository';

export interface IPasskeyCredentialRepository {
  /**
   * Look up a credential by its WebAuthn id, loading the bound wallet + user so the
   * finish flow can match the email for an idempotent-replay of a completed
   * registration. Active (non-soft-deleted) rows only.
   */
  findByCredentialId(credentialId: string): Promise<PasskeyCredential | null>;
  /** Look up the ACTIVE passkey credential bound to a wallet (1:1). */
  findByWalletId(walletId: string): Promise<PasskeyCredential | null>;
}
