import {
  IMarketplaceSettlerReadService,
  MarketplaceSettlerReadUnavailableError,
} from '@modules/marketplace/settlement/marketplace-settler-read.service.interface';

/**
 * In-memory `MARKETPLACE_SETTLER_READ_SERVICE` for tests. Deterministic. Seed settled `(rfqId, quoteId)`
 * pairs; unknown pairs read `false`. `failNext()` makes the next read throw
 * `MarketplaceSettlerReadUnavailableError` (the "unknown → retry" branch the worker must handle).
 */
export class FakeMarketplaceSettlerRead implements IMarketplaceSettlerReadService {
  readonly calls: Array<{ rfqId: string; quoteId: string }> = [];
  private readonly settled = new Set<string>();
  private shouldFail = false;

  private k(rfqId: string, quoteId: string): string {
    return `${rfqId}:${quoteId}`;
  }

  /** Mark a trade as settled on-chain (adopt-as-success path). */
  markSettled(rfqId: string, quoteId: string): void {
    this.settled.add(this.k(rfqId, quoteId));
  }

  /** Make the next `isSettled` throw (unavailable read → retry). */
  failNext(): void {
    this.shouldFail = true;
  }

  reset(): void {
    this.calls.length = 0;
    this.settled.clear();
    this.shouldFail = false;
  }

  isSettled(rfqId: string, quoteId: string): Promise<boolean> {
    this.calls.push({ rfqId, quoteId });
    if (this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new MarketplaceSettlerReadUnavailableError());
    }
    return Promise.resolve(this.settled.has(this.k(rfqId, quoteId)));
  }
}
