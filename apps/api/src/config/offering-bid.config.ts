import { registerAs } from '@nestjs/config';

/**
 * The ONE default for `OFFERING_MAX_BIDS_PER_OFFERING` (TOV-160 #332) — imported by BOTH offering configs and
 * the Joi schema so the submit gate and the settle belt can never diverge on this on-chain money ceiling when
 * the env var is unset.
 */
export const OFFERING_MAX_BIDS_DEFAULT = 40;

/**
 * Offering bid submission + escrow-worker config (TOV-156, FR-05.03). No signing secret — the collector's
 * passkey (client) authorizes the escrow transfer and the shared relayer keypair (`relayer.config`) is the
 * tx source/fee-payer. The only knobs are the per-bid USDC cost ceiling and the reconcile-sweep cadence.
 */
export const offeringBidConfig = registerAs('offeringBid', () => ({
  // Ceiling on a bid's escrowed amount (price*count) in USDC stroops — mirrors RELAYER_MAX_TRANSFER_AMOUNT.
  maxBidCostStroops: process.env.OFFERING_BID_MAX_COST_STROOPS ?? '1000000000000',
  // TOV-160: hard ceiling on ACTIVE bids per offering, enforced at submission. The on-chain
  // close_and_settle refunds EVERY active bid in ONE atomic tx (write-ledger-entry bound ~tens/tx), so a
  // book above this could never settle. SAME env var as offering-escrow.config (one source of truth): the
  // submit gate here rejects OFFERING_TOO_MANY_BIDS; the settle belt there is the defence-in-depth.
  maxBidsPerOffering: parseInt(
    process.env.OFFERING_MAX_BIDS_PER_OFFERING ?? String(OFFERING_MAX_BIDS_DEFAULT),
    10,
  ),
  // NB: the reconcile-sweep knobs were removed (todo 294) — no bid reconciler ships in this feature; the
  // safe DB↔chain reconciler is a live-testnet-gated follow-up, and stranded bids are handled manually.
}));

export type OfferingBidConfig = ReturnType<typeof offeringBidConfig>;
