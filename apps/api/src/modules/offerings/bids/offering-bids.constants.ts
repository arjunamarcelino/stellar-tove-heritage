/**
 * BullMQ queue name for the async bid-escrow pipeline (TOV-156). Kept in a dependency-free leaf so the
 * producer (the public surface module) and the consumer (the worker module) share it without a cross-
 * import cycle — mirrors `offering.constants.ts`.
 *
 * NB: there is deliberately no reconcile queue. The safe DB↔chain reconciler (adopt-as-escrowed on the
 * contract's `DuplicateBid`) is a documented follow-up requiring live-testnet validation; until it ships,
 * a stranded `submitted` bid is resolved manually (see the monitoring runbook, todo 302).
 */
export const OFFERING_BID_ESCROW_QUEUE = 'offering-bid-escrow';

/**
 * BullMQ queue name for the async bid-CANCEL/refund pipeline (TOV-158, FR-05.04). Separate from the escrow
 * queue so the two flows have independent pause/drain/depth-alerting and so the worker's INVERTED money-safety
 * classifier (`canceling → escrowed` on provably-no-refund vs the escrow worker's slot-freeing `casFailed`)
 * stays physically isolated. Both workers still serialize on the SAME shared `relayer:account:${pubkey}`
 * send-lock (one relayer keypair, ~1 tx/ledger) — see the plan's R6.
 */
export const OFFERING_BID_CANCEL_QUEUE = 'offering-bid-cancel';
