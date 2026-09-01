import { STELLAR_NETWORK } from '@/lib/constants';

// Shared Stellar address display helpers (extracted from components/auth/PasskeySignup.tsx so the
// passkey success screen and the wallet-export success screen render addresses identically).

// Middle-truncate a long address: GABC12…XYZ789. Short strings are returned unchanged.
export function truncateAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

// Stellar Expert path segment follows the configured network (testnet vs public) rather than a
// hardcoded 'testnet', so the links stay correct when the app moves to mainnet.
const EXPLORER_BASE = `https://stellar.expert/explorer/${STELLAR_NETWORK.name}`;

// Soroban smart-contract wallets (C… addresses — e.g. the embedded passkey wallet).
export function explorerContractUrl(address: string): string {
  return `${EXPLORER_BASE}/contract/${address}`;
}

// Classic Stellar accounts (G… addresses — e.g. a self-custody export destination).
export function explorerAccountUrl(address: string): string {
  return `${EXPLORER_BASE}/account/${address}`;
}

// A settled transaction (hex hash) — proof-of-settlement links on the partial/success screens. Encoded
// defensively so a malformed backend hash can't break the href (a valid hex hash encodes to itself).
export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${encodeURIComponent(txHash)}`;
}

// Format a scaled-i128 integer string (base units) to its decimal display value. BigInt-based — the
// values can exceed Number.MAX_SAFE_INTEGER, so we never touch Number/parseFloat. Trailing zeros in
// the fraction are trimmed ("10.5000000" → "10.5", "5" with 0 decimals → "5").
//
// On an unexpected input (non-digit amount, negative/non-integer/oversized decimals) this returns the
// AMOUNT_UNAVAILABLE sentinel rather than a raw string — on the irreversible confirm screen a
// malformed value must never render as a plausible number. The service schema (exportItemSchema)
// rejects such values upstream, so this branch is a defense-in-depth backstop.
export const AMOUNT_UNAVAILABLE = '—';

export function formatTokenAmount(amountScaled: string, decimals: number): string {
  if (!/^\d+$/.test(amountScaled)) return AMOUNT_UNAVAILABLE;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) return AMOUNT_UNAVAILABLE;
  if (decimals === 0) return amountScaled;

  const padded = amountScaled.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
