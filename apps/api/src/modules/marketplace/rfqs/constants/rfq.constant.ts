/**
 * Dependency-free policy constants for RFQ creation (TOV-172, FR-06.01).
 */

/** Default RFQ lifetime when `expiry_hours` is omitted (Gherkin: `expires_at = created_at + 48h`). */
export const DEFAULT_EXPIRY_HOURS = 48;

/** Inclusive bounds on a caller-supplied `expiry_hours`. */
export const MIN_EXPIRY_HOURS = 1;
export const MAX_EXPIRY_HOURS = 168;

/**
 * Per-collector ceiling on simultaneously-`open` RFQs. Abuse control: the 20/60s throttle bounds burst
 * rate but not the standing count, and every create fires a relayer balance RPC — so a whitelisted
 * collector could otherwise accrue thousands of open RFQs. A generous fixed cap stops spam while
 * preserving "multiple RFQs per artwork allowed" (there is intentionally no per-artwork uniqueness).
 */
export const MAX_ACTIVE_OPEN_RFQS = 25;

/**
 * Wall-clock deadline (ms) for the best-effort soft-warn USDC balance read. `readWalletHoldings` makes two
 * sequential Soroban RPCs, so without a bound a slow chain could pin the HTTP create request for seconds for
 * a warning that never blocks creation. Kept deliberately tight (1.2s) so the create path stays responsive —
 * a soft-warn rarely needs longer, and on timeout the warning is simply dropped (still 201, no warning),
 * comfortably under the 30s idempotency in-flight TTL.
 */
export const BALANCE_WARN_DEADLINE_MS = 1200;
