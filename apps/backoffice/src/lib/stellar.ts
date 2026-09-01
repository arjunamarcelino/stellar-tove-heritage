import { z } from 'zod';

/**
 * Client-safe Stellar explorer helpers. Kept in `lib/` (not the artworks slice) as generic chain
 * infrastructure that upcoming M04/M05 features (offerings, holdings) will also consume. Deliberately does
 * NOT import `@/lib/env` (that module is `server-only`); the network is read from a `NEXT_PUBLIC_` var so it
 * works in client components.
 */

// Stellar StrKeys are RFC-4648 base32 (alphabet A-Z2-7 — no 0/1/8/9). Contract keys start with `C`
// and are 56 chars total.
const CONTRACT_STRKEY_PATTERN = /^C[A-Z2-7]{55}$/;

const networkSchema = z.enum(['testnet', 'mainnet']).catch('testnet');

function getNetwork(): 'testnet' | 'mainnet' {
  return networkSchema.parse(process.env.NEXT_PUBLIC_STELLAR_NETWORK);
}

/** True when `address` is a well-formed Stellar contract StrKey (C…, base32, 56 chars). */
export function isValidContractAddress(address: string): boolean {
  return CONTRACT_STRKEY_PATTERN.test(address);
}

/**
 * Build a stellar.expert explorer URL for a deployed FractionToken contract, or `null` if the
 * address is malformed (so callers omit the link rather than render a broken one). The API exposes
 * no tx hash, so we link the contract — not a transaction.
 */
export function explorerContractUrl(tokenAddress: string): string | null {
  if (!isValidContractAddress(tokenAddress)) return null;
  return `https://stellar.expert/explorer/${getNetwork()}/contract/${tokenAddress}`;
}

// Soroban tx hashes are 32-byte hex (64 lowercase hex chars).
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Build a stellar.expert explorer URL for a submitted transaction, or `null` if the hash is malformed
 * (so callers omit the link rather than render a broken one). Distinct from `explorerContractUrl`.
 */
export function explorerTxUrl(txHash: string): string | null {
  if (!TX_HASH_PATTERN.test(txHash)) return null;
  return `https://stellar.expert/explorer/${getNetwork()}/tx/${txHash.toLowerCase()}`;
}

/**
 * Classify a pasted address by StrKey prefix so the UI can give tailored "wrong type" messages
 * (case-insensitive: a lowercased StrKey paste still classifies). Prefixes: C=contract, G=account,
 * S=SECRET seed (never echo/log), M=muxed; plus 0x… for an Ethereum paste mistake.
 */
export type StrKeyKind = 'contract' | 'account' | 'secret' | 'muxed' | 'evm' | 'unknown';
export function classifyAddress(value: string): StrKeyKind {
  const v = value.toUpperCase();
  if (CONTRACT_STRKEY_PATTERN.test(v)) return 'contract';
  if (/^G[A-Z2-7]{55}$/.test(v)) return 'account';
  if (/^S[A-Z2-7]{55}$/.test(v)) return 'secret';
  if (/^M[A-Z2-7]{68}$/.test(v)) return 'muxed';
  if (/^0X[0-9A-F]{40}$/.test(v)) return 'evm';
  return 'unknown';
}
