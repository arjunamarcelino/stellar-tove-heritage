import { createHash } from 'node:crypto';
import { p256 } from '@noble/curves/p256';

/**
 * Pure secp256r1 (P-256) WebAuthn-assertion crypto for the passkey-signed transfer path (TOV-22).
 * No `@stellar/stellar-sdk` import, so it is unit-testable against fixed vectors.
 *
 * ⚠️ Low-S is load-bearing. Soroban's on-chain `secp256r1_verify` (CAP-0051) REJECTS non-low-S
 * signatures, but `@simplewebauthn`/WebCrypto happily accept high-S — and ~half of real platform
 * passkeys emit high-S. So we normalize S to the low half BEFORE encoding the 64-byte `r‖s` we
 * submit, and verify exactly those normalized bytes, so the backend check and the chain agree.
 */

/** Uncompressed secp256r1 public key length: 0x04 ‖ x(32) ‖ y(32). */
const P256_PUBLIC_KEY_SIZE = 65;
/** Raw ECDSA signature length: r(32) ‖ s(32). */
const P256_RAW_SIGNATURE_SIZE = 64;

/**
 * Parse a DER-encoded ECDSA signature (as WebAuthn authenticators emit) into the raw, **low-S
 * normalized** 64-byte `r‖s` form the Soroban auth entry requires. Throws on a malformed signature
 * or an out-of-range `r`/`s` (noble validates `0 < r,s < n`); the caller maps that to a rejection.
 */
export function toLowSCompactSignature(der: Uint8Array): Buffer {
  const sig = p256.Signature.fromDER(der);
  const lowS = sig.hasHighS() ? sig.normalizeS() : sig;
  return Buffer.from(lowS.toCompactRawBytes());
}

/**
 * The WebAuthn signed message: `authenticatorData ‖ sha256(clientDataJSON)`. The authenticator's
 * ES256 signature is ECDSA over `sha256` of this — i.e. the on-chain
 * `secp256r1_verify(pk, sha256(authenticatorData ‖ sha256(clientDataJSON)), sig)` digest.
 */
export function webauthnSignedMessage(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Buffer {
  const clientDataHash = createHash('sha256').update(clientDataJSON).digest();
  return Buffer.concat([Buffer.from(authenticatorData), clientDataHash]);
}

/**
 * Verify a secp256r1 WebAuthn assertion against the wallet's bound public key. `signatureCompact` is
 * the low-S 64-byte `r‖s` we will submit (verify the exact bytes, not the raw device DER, since Node
 * / WebCrypto accept high-S). `publicKey` is the 65-byte uncompressed point. Enforces low-S.
 */
export function verifyP256Assertion(
  publicKey: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signatureCompact: Uint8Array,
): boolean {
  if (publicKey.length !== P256_PUBLIC_KEY_SIZE || publicKey[0] !== 0x04) {
    throw new Error(`expected a ${P256_PUBLIC_KEY_SIZE}-byte uncompressed P-256 point`);
  }
  if (signatureCompact.length !== P256_RAW_SIGNATURE_SIZE) {
    throw new Error(`expected a ${P256_RAW_SIGNATURE_SIZE}-byte raw signature`);
  }
  const message = webauthnSignedMessage(authenticatorData, clientDataJSON);
  const digest = createHash('sha256').update(message).digest();
  // noble treats arg 2 as the already-hashed digest; { lowS: true } rejects a non-normalized S.
  return p256.verify(signatureCompact, digest, publicKey, { lowS: true });
}
