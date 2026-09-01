/**
 * BullMQ job payload for the async escrow submit (TOV-156). This is the ONE new serialization boundary in
 * the flow: BullMQ `JSON.stringify`s the payload into Redis, so EVERY field must round-trip losslessly —
 * NO `Uint8Array`/`Buffer`/`bigint` (they don't survive JSON). The passkey assertion + key travel as
 * base64url strings; the processor decodes them to `Buffer` at the relayer port boundary. The signed
 * assertion is a short-lived bearer credential — kept only in the job payload (never persisted on the row),
 * never logged.
 */
export interface OfferingBidEscrowJob {
  readonly bidId: string;
  readonly walletContract: string;
  readonly escrowContract: string;
  readonly tokenContract: string;
  readonly priceScaled: string;
  readonly count: string;
  readonly maxCostScaled: string;
  readonly idempotencyKey: string; // base64url (the server-derived BytesN<32> pinned in the signed tx)
  readonly txXdr: string; // base64 (XDR)
  readonly boundPublicKey: string; // base64url (raw P-256, 65 bytes)
  readonly credentialId: string;
  readonly authenticatorData: string; // base64url
  readonly clientDataJSON: string; // base64url
  readonly signature: string; // base64url (DER)
  readonly rpId: string;
  readonly allowedOrigins: readonly string[];
}
