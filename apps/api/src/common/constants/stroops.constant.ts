/**
 * Dependency-free leaf constants for USDC/Soroban money amounts, shared across every domain that handles
 * stroop-denominated values (offerings, marketplace RFQs, …). Homed in `@common` — NOT under any one
 * feature module — so pipe-layer DTOs and services can import them without a cross-domain edge and without
 * pulling any TypeORM entity. Mirrors the "import down, never sideways" rule.
 */

/** Canonical non-negative integer: no leading zeros / '+' / whitespace / decimals / scientific notation. */
export const STROOPS_RE = /^(0|[1-9]\d*)$/;

/**
 * 2^96−1 — the per-unit ceiling for a single stroop amount (a price/amount above this would overflow the
 * on-chain USDC amount type). Shared with the offerings band CHECK (`CHK_off_band`) and the RFQ price CHECK.
 */
export const MAX_STROOPS = 79228162514264337593543950335n;

/**
 * 2^127−1 — the signed i128 ceiling. Per-unit stroop amounts are bounded by `MAX_STROOPS` (2^96−1), but
 * AGGREGATE amounts (e.g. `price × count`, settlement proceeds/fees summed over many bids) have the on-chain
 * i128 as their true domain. Callers that compute such aggregates in BigInt must pre-check them against this
 * ceiling and fail cleanly BEFORE any on-chain call or persistence, since the contracts compute with
 * unchecked i128 arithmetic (an overflow is an untyped host panic, not a typed contract error). Also the
 * upper bound for aggregate-amount DB CHECKs (e.g. `offering_clearing_audit`).
 */
export const MAX_I128 = 170141183460469231731687303715884105727n;
