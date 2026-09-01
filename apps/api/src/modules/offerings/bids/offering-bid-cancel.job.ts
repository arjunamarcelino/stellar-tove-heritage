/**
 * BullMQ job payload for the async cancel/refund submit (TOV-158, FR-05.04). Same serialization boundary
 * discipline as {@link ./offering-bid-escrow.job.OfferingBidEscrowJob}: BullMQ `JSON.stringify`s the payload
 * into Redis, so EVERY field must round-trip losslessly — NO `Uint8Array`/`Buffer`/`bigint`. The passkey
 * assertion travels as base64url strings; the processor decodes them to `Buffer` at the relayer port boundary.
 * The signed `cancel_bid` assertion is a short-lived bearer credential — kept only in the job payload (never
 * persisted on the row), never logged.
 *
 * Simpler than the escrow job: `cancel_bid(caller, bid_id)` has no price/count/idempotency-key args and its
 * auth tree is root-only (no nested transfer), so there is no `tokenContract`/`priceScaled`/`count`/
 * `maxCostScaled`/`idempotencyKey`. `chainBidId` is the on-chain `bid_id` (u32) being canceled; `walletContract`
 * is the bid's recorded `collector_wallet` (the server-trusted `caller`, pinned by the verifier).
 */
export interface OfferingBidCancelJob {
  readonly bidId: string; // the offering_bids row id
  readonly walletContract: string; // bid.collector_wallet = the on-chain cancel_bid `caller`
  readonly escrowContract: string;
  readonly chainBidId: number; // on-chain bid_id (u32) to cancel
  readonly txXdr: string; // base64 (XDR)
  readonly boundPublicKey: string; // base64url (raw P-256, 65 bytes)
  readonly credentialId: string;
  readonly authenticatorData: string; // base64url
  readonly clientDataJSON: string; // base64url
  readonly signature: string; // base64url (DER)
  readonly rpId: string;
  readonly allowedOrigins: readonly string[];
}
