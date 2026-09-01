// Feature-neutral money/amount constants for the whole platform (Stellar/USDC stroops). Promoted out of
// lib/offerings/constants.ts (TOV-173) so non-offering money surfaces — the RFQ create flow, and future
// marketplace features — don't depend on the offering namespace for chain-general arithmetic. lib/offerings/
// re-exports these so existing offering imports keep working (mirrors the MONEY_FIGURE → components/ui promotion).

export const USDC_DECIMALS = 7;

// BigInt(...) not the `10_000_000n` literal — the tsconfig target predates ES2020 BigInt literals (pnpm build
// rejects `n` literals).
export const STROOPS_PER_USDC = BigInt(10_000_000); // 10^7

// Signed i128 max (2^127 − 1) — the ceiling for a `price × count` product before it reaches a Soroban contract.
export const I128_MAX = BigInt('170141183460469231731687303715884105727');

// Unsigned u96 max (2^96 − 1) — the ceiling for a SINGLE per-fraction price (RFQ create). Distinct from
// I128_MAX (the product bound): both must be checked independently.
export const U96_MAX = BigInt('79228162514264337593543950335');
