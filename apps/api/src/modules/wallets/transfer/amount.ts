/**
 * Pure decimal→i128 amount scaling for USDC transfers (TOV-22). No SDK import, golden-tested.
 * USDC on Stellar is a fixed 7-decimal SAC; a wrong scale is an order-of-magnitude money error, so
 * this is BigInt arithmetic (i128 exceeds Number.MAX_SAFE_INTEGER) with strict validation.
 */

/** USDC SAC decimals (fixed; cross-checked once at boot against the on-chain `decimals()`). */
export const USDC_DECIMALS = 7;

/** Signed 128-bit max: 2^127 - 1. A transfer amount must fit i128. */
const I128_MAX = (1n << 127n) - 1n;

/** A non-negative decimal string (no sign, no exponent). Shared with the DTO's `@Matches`. */
export const DECIMAL_STRING_RE = /^\d+(\.\d+)?$/;

/**
 * Scale a human decimal string (e.g. "1.5") to the token's smallest unit as a BigInt (e.g. 15000000
 * at 7dp). Throws on a non-decimal string, more fractional digits than `decimals`, a non-positive
 * amount, or an amount exceeding i128 — the caller maps the throw to a 400 / SIGNATURE_INVALID.
 */
export function scaleAmountToI128(amount: string, decimals: number): bigint {
  if (!DECIMAL_STRING_RE.test(amount)) {
    throw new Error('amount must be a non-negative decimal string');
  }
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > decimals) {
    throw new Error(`amount has more than ${decimals} fractional digits`);
  }
  const scaled = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (scaled <= 0n) {
    throw new Error('amount must be greater than zero');
  }
  if (scaled > I128_MAX) {
    throw new Error('amount exceeds the maximum i128 value');
  }
  return scaled;
}
