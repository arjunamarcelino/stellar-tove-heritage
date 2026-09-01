/**
 * Wall-clock deadline (ms) for the single blocking on-chain FractionToken `balance()` read that backs the
 * hard free-balance gate. Tighter than the fraction-read config's inherited 5s `timeoutMs` because this is
 * ONE lightweight simulate on a synchronous POST (not the O(catalog) holdings fan-out): 2.5s caps the
 * user-visible 503 tail while leaving ~6–25× headroom over a healthy ~100–400ms simulate. On timeout the
 * read fails closed → 503 QUOTE_BALANCE_UNAVAILABLE (never a silent 0). Target endpoint p99 ≤ 3s.
 */
export const QUOTE_BALANCE_TIMEOUT_MS = 2500;
