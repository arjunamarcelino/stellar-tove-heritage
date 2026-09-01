/**
 * A FractionToken on-chain balance read failed (RPC timeout, simulation error, absent/garbage retval).
 * Operational, not a business answer — the service maps it to a generic `503 HOLDINGS_UNAVAILABLE`
 * (complete-or-nothing; a partial holdings list would mis-gate a Sell). The specific token/RPC detail is
 * carried here for SERVER-SIDE logging only and must never reach the HTTP body. Mirrors
 * `KycAllowlistThrottledError` (plain `extends Error`).
 */
export class FractionReadUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FractionReadUnavailableError';
  }
}
