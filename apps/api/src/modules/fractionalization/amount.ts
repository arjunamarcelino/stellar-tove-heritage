import { FractionReadUnavailableError } from './fraction-read.errors';

/** Integer-only guard: `numeric(39,0)` columns and on-chain i128 balances are whole decimal strings. */
const INTEGER_RE = /^-?\d+$/;

/**
 * Parse a decimal-string amount into a `bigint`. Rejects `''`, `null`/`undefined`, decimals, and garbage
 * (raw `BigInt('')`/`BigInt('60.0')` throw). With `{ nonNegative: true }` also rejects a negative value —
 * an on-chain token balance is a `u128`, so a `-N` decode is corruption, not a holding. A bad amount is an
 * operational read failure, not a business answer, so it surfaces as {@link FractionReadUnavailableError}
 * → 503 (never a silent `0`).
 */
export function parseAmount(
  value: string | null | undefined,
  field: string,
  opts?: { nonNegative?: boolean },
): bigint {
  if (value == null || !INTEGER_RE.test(value)) {
    throw new FractionReadUnavailableError(`invalid amount for ${field}`);
  }
  const parsed = BigInt(value);
  if (opts?.nonNegative && parsed < 0n) {
    throw new FractionReadUnavailableError(`negative amount for ${field}`);
  }
  return parsed;
}
