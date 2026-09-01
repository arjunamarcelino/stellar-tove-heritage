export const QUOTE_SETTLE_QUEUE = 'quote-settle';
export const QUOTE_SETTLE_JOB = 'settle';
/** Repeatable reconcile queue (TOV-177 #382): the lost-enqueue / retry-exhausted backstop for stale trades. */
export const QUOTE_SETTLE_RECONCILE_QUEUE = 'quote-settle-reconcile';

/**
 * The self-contained BullMQ payload for the async settle worker (TOV-177). JSON-safe only — NO Buffer/bigint;
 * the buyer assertion + both auth entries + bound key travel as base64url/base64 strings (decoded to
 * `Uint8Array` at the relayer boundary). The signed authorizations are short-lived bearer material — job
 * payload only (`removeOnComplete`/bounded `removeOnFail`), never persisted beyond the quote row, never logged.
 */
export interface QuoteSettleJob {
  tradeId: string;
  rfqId: string; // DB uuid (for the persist CAS + is_settled)
  quoteId: string; // DB uuid
  settlerContract: string;
  usdcContract: string;
  buyerWallet: string;
  sellerWallet: string;
  rfqId32: string; // base64url of the 32-byte tuple ids
  quoteId32: string;
  artworkId32: string;
  count: string;
  gross: string;
  buyerAuthEntryXdr: string; // base64 XDR
  storedSellerEntryXdr: string; // base64 XDR (the signed seller entry from the quote)
  boundPublicKey: string; // base64url
  credentialId: string;
  authenticatorData: string; // base64url
  clientDataJSON: string; // base64url
  signature: string; // base64url
  rpId: string;
  allowedOrigins: string[];
}
