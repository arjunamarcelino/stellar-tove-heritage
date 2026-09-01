import { createHash } from 'node:crypto';
import { IKycAllowlistTxService, KycAllowlistSubmitResult } from '../../src/modules/kyc-allowlist/kyc-allowlist-tx.service.interface';
import { KycAllowlistAction } from '../../src/modules/kyc-allowlist/kyc-allowlist.types';

/**
 * In-memory {@link IKycAllowlistTxService} for unit + e2e suites — same contract without Soroban/Redis.
 * Tracks the on-chain `is_allowed` set; `submitOne` mutates it (or is configured to fail / go pending).
 * Mirrors the `FakeRelayerService` / `FakeFractionFactoryService` pattern.
 */
export class FakeKycAllowlistService implements IKycAllowlistTxService {
  readonly submitCalls: { action: KycAllowlistAction; wallet: string }[] = [];
  private readonly allowed = new Set<string>();
  private readonly failWallets = new Set<string>();
  private readonly pendingWallets = new Set<string>();
  private readonly readFailWallets = new Set<string>();
  private ledger = 100;

  /** Seed a wallet as already on-chain-allowlisted. */
  setAllowed(wallet: string): void {
    this.allowed.add(wallet);
  }
  /** submitOne(wallet) will throw (→ per-item `failed`). */
  failOn(wallet: string): void {
    this.failWallets.add(wallet);
  }
  /** submitOne(wallet) returns `pending` (→ stop-and-defer). */
  pendingOn(wallet: string): void {
    this.pendingWallets.add(wallet);
  }
  /** isAllowed(wallet) will throw (→ per-item `failed` at the read phase). */
  readFailOn(wallet: string): void {
    this.readFailWallets.add(wallet);
  }

  /** Clear all state between tests (the provider is a singleton `useValue`). */
  reset(): void {
    this.submitCalls.length = 0;
    this.allowed.clear();
    this.failWallets.clear();
    this.pendingWallets.clear();
    this.readFailWallets.clear();
    this.ledger = 100;
  }

  isAllowed(wallet: string): Promise<boolean> {
    if (this.readFailWallets.has(wallet)) return Promise.reject(new Error('fake is_allowed unavailable'));
    return Promise.resolve(this.allowed.has(wallet));
  }

  submitOne(action: KycAllowlistAction, wallet: string): Promise<KycAllowlistSubmitResult> {
    this.submitCalls.push({ action, wallet });
    if (this.failWallets.has(wallet)) return Promise.reject(new Error('fake submit failure'));
    const txHash = createHash('sha256').update(`tx:${action}:${wallet}`).digest('hex');
    if (this.pendingWallets.has(wallet)) return Promise.resolve({ status: 'pending', txHash });
    if (action === 'add') this.allowed.add(wallet);
    else this.allowed.delete(wallet);
    return Promise.resolve({ status: 'confirmed', txHash, ledger: this.ledger++ });
  }
}
