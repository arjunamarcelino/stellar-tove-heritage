import { createHash } from 'node:crypto';

/**
 * Passkey signer encoding for `FractionWalletFactory.deploy_wallet`, byte-identical to
 * smart-account-kit (`src/utils.ts`) so the frontend + factory derive the same wallet.
 * Pure (no `@stellar/stellar-sdk`) so it's unit-testable against fixed vectors.
 */

/** WebAuthn credential id (base64url) -> raw bytes. */
export function decodeCredentialId(credentialId: string): Buffer {
  return Buffer.from(credentialId, 'base64url');
}

/** Deterministic deploy salt = sha256(raw credential-id bytes). */
export function deriveSalt(credentialId: string): Buffer {
  return createHash('sha256').update(decodeCredentialId(credentialId)).digest();
}

/** Byte length of an uncompressed secp256r1 (P-256) public key: 0x04 ‖ x(32) ‖ y(32). */
const SECP256R1_PUBLIC_KEY_SIZE = 65;

/**
 * External-signer key_data = 65-byte uncompressed secp256r1 point (0x04‖x‖y) ‖ raw
 * credential-id bytes (pubkey first). Asserts the point length: a malformed signer feeds an
 * on-chain, fee-spending, unrecoverable deploy, so fail loud at the boundary.
 */
export function buildKeyData(secp256r1PublicKey: Uint8Array, credentialId: string): Buffer {
  if (secp256r1PublicKey.length !== SECP256R1_PUBLIC_KEY_SIZE) {
    throw new Error(
      `expected a ${SECP256R1_PUBLIC_KEY_SIZE}-byte uncompressed secp256r1 point, got ${secp256r1PublicKey.length}`,
    );
  }
  return Buffer.concat([Buffer.from(secp256r1PublicKey), decodeCredentialId(credentialId)]);
}
