export const MARKETPLACE_SETTLER_READ_SERVICE = 'IMarketplaceSettlerReadService';

/**
 * Thrown when the `is_settled` read cannot be completed (RPC/timeout/simulation failure). The settle worker
 * MUST distinguish this ("unknown — retry") from a genuine `false` ("not settled — safe to terminal-fail"):
 * a coerced `false` on an unavailable read would wrongly free the double-accept latch and terminal-fail a
 * trade that may have already landed on-chain. Mirrors `FractionReadUnavailableError` (complete-or-nothing).
 */
export class MarketplaceSettlerReadUnavailableError extends Error {
  constructor(message = 'marketplace settler is_settled read unavailable') {
    super(message);
    this.name = 'MarketplaceSettlerReadUnavailableError';
  }
}

/**
 * Read-only port over `MarketplaceSettler.is_settled(rfq_id, quote_id)` (TOV-177) — the settle worker's
 * self-heal oracle. Simulate-only, signs nothing, no lock. Kept distinct from the fat `RELAYER_SERVICE`
 * (which owns the passkey WRITE flow) exactly like `FRACTION_READ_SERVICE`. Tests override with a fake.
 */
export interface IMarketplaceSettlerReadService {
  /**
   * `is_settled(sha256(rfqId), sha256(quoteId))` via simulate-only RPC. `true` ⇒ the atomic accept_quote
   * landed (adopt-as-success); `false` ⇒ a GENUINE not-settled read. THROWS
   * `MarketplaceSettlerReadUnavailableError` on ANY RPC/timeout/simulation failure — NEVER returns `false`
   * on an unavailable read. `rfqId`/`quoteId` are UUID strings; the sha256→BytesN<32> derivation is internal.
   */
  isSettled(rfqId: string, quoteId: string): Promise<boolean>;
}
