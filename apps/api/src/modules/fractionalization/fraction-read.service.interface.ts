export const FRACTION_READ_SERVICE = 'IFractionReadService';

/**
 * Read-only port over FractionToken balances (TOV-237). Kept distinct from the deploy-focused
 * `FRACTION_FACTORY_SERVICE` (a serialized signing/write boundary) and from the money-path
 * `RELAYER_SERVICE`: reads are simulate-only, sign nothing, and fan out in bounded parallel. Tests
 * override the token with an in-memory fake.
 */
export interface IFractionReadService {
  /**
   * `balance(wallet)` for each token contract via simulate-only RPC, in bounded parallel. Returns a
   * `tokenContract → decimal string` map. Throws `FractionReadUnavailableError` if ANY single read fails
   * (complete-or-nothing). A successful `0` is a genuine zero balance — never a coerced failure.
   *
   * `opts.timeoutMs` overrides BOTH the per-read timeout and the overall budget for this call. The
   * synchronous single-token quote path passes a tight (~2.5s) value so an abandoned RPC socket is released
   * at that deadline rather than lingering to the config's 5s per-read timeout (TOV-175 #374). Omit it for the
   * holdings fan-out, which wants the config's larger per-read/budget bounds.
   */
  balancesOf(
    tokenContracts: string[],
    wallet: string,
    opts?: { timeoutMs?: number },
  ): Promise<Map<string, string>>;
}
