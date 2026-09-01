import { createHash } from 'node:crypto';

/**
 * Derive the on-chain `idempotency_key` (BytesN<32>) baked into the signed `submit_bid` tx (TOV-156):
 * `sha256(offeringId | collectorSub | HTTP Idempotency-Key)`. Deterministic, so a replayed `/prepare`
 * rebuilds an equivalent tx and `/submit` re-derives the identical value; this ties the HTTP idempotency
 * scope to the contract's own on-chain `DuplicateBid` guard end to end (and to `UQ_offering_bids_idem`).
 */
export function deriveOnChainIdemKey(
  offeringId: string,
  collectorSub: string,
  httpKey: string,
): Buffer {
  return createHash('sha256').update(`${offeringId}|${collectorSub}|${httpKey}`).digest();
}
