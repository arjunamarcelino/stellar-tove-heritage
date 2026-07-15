/**
 * Terminal, caller-facing relayer transfer errors (TOV-22). Part of the RELAYER_SERVICE port
 * contract: the surface (`WalletTransferService`) maps `reason` -> HTTP status + ErrorCode without
 * reaching into adapter internals via `instanceof` on concrete classes. Kept DISJOINT from the
 * adapter's internal retryable errors (txBadSeq/throttle), which must never reach the HTTP mapper.
 */
export type TransferErrorReason =
  | 'simulation_failed' // simulate rejected: balance, consumed nonce/replay, undeployed wallet
  | 'expired' // signatureExpirationLedger passed before submit
  | 'signature_required' // no/empty passkey assertion attached (defense-in-depth)
  | 'signature_invalid' // integrity/binding/normalization/UV/origin/fee failure
  | 'transfer_failed' // accepted but failed on apply
  | 'unavailable'; // RPC timeout / relayer underfunded

export class RelayerTransferError extends Error {
  constructor(
    readonly reason: TransferErrorReason,
    message?: string,
  ) {
    super(message ?? `relayer transfer failed: ${reason}`);
    this.name = 'RelayerTransferError';
  }
}
