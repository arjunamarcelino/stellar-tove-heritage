import { StrKey } from '@stellar/stellar-sdk';

/**
 * Canonicalize a Stellar StrKey to its unique base32 form, or throw. StrKeys are case-sensitive base32
 * with exactly one valid encoding, so this is decode→re-encode (idempotent) — its real job is to reject
 * non-canonical / invalid input and strip surrounding whitespace, so the KYC allowlist and the on-chain
 * `to` compare byte-exactly. NEVER lowercase a StrKey. Accepts G- (ed25519) and C- (contract) keys.
 */
export function canonicalizeStellarAddress(address: string): string {
  const trimmed = address.trim();
  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return StrKey.encodeEd25519PublicKey(StrKey.decodeEd25519PublicKey(trimmed));
  }
  if (StrKey.isValidContract(trimmed)) {
    return StrKey.encodeContract(StrKey.decodeContract(trimmed));
  }
  throw new Error('not a canonical Stellar address (G... or C...)');
}

/** Whether `address` is a self-custody account (G-address). Fraction export targets are G-addresses. */
export function isStellarAccountAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address.trim());
}
