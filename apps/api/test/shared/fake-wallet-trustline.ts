import {
  IWalletTrustlineService,
  TrustlineInstruction,
} from '../../src/modules/wallets/wallet-trustline.service.interface';

/**
 * Deterministic in-memory `WALLET_TRUSTLINE_SERVICE` for e2e/integration/unit tests — no Soroban RPC.
 * Seed `instructions` (publicKey → instruction, or null for "already trusts") for the happy paths, or
 * `error` to prove the service tolerates a throwing port (the P1 idempotency guard). `calls` counts
 * invocations so a test can assert the instruction is re-resolved on replay (never cached).
 */
export class FakeWalletTrustlineService implements IWalletTrustlineService {
  public calls = 0;
  public readonly instructions = new Map<string, TrustlineInstruction | null>();
  public error: Error | null = null;

  reset(): void {
    this.calls = 0;
    this.instructions.clear();
    this.error = null;
  }

  resolveUsdcTrustline(publicKey: string): Promise<TrustlineInstruction | null> {
    this.calls++;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.instructions.get(publicKey) ?? null);
  }
}
