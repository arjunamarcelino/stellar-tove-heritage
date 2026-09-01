import { IFractionReadService } from '../../src/modules/fractionalization/fraction-read.service.interface';

/**
 * Deterministic in-memory `FRACTION_READ_SERVICE` for e2e/integration tests — no Soroban RPC. Set
 * `balances` (tokenContract → decimal string) for the happy path, or `error` to simulate an RPC failure.
 * `calls` counts invocations so a test can assert a cache hit skips the read.
 */
export class FakeFractionReadService implements IFractionReadService {
  public calls = 0;
  public readonly balances = new Map<string, string>();
  public error: Error | null = null;

  reset(): void {
    this.calls = 0;
    this.balances.clear();
    this.error = null;
  }

  // The wallet arg is unused by the fake (deterministic per-token balances), so it is omitted — an impl
  // with fewer params still satisfies IFractionReadService.
  balancesOf(tokenContracts: string[]): Promise<Map<string, string>> {
    this.calls++;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(new Map(tokenContracts.map((t) => [t, this.balances.get(t) ?? '0'])));
  }
}
