/**
 * Domain error raised by the neutral rotation orchestration when a holdings-transfer gate fails (TOV-33).
 * The rotation domain stays free of HTTP/ErrorCode concerns; the surface maps `reason` to the HTTP status +
 * errorCode via `ROTATION_ERROR_MAP`. Sibling of {@link WalletMutationError}. The union includes reasons for
 * the codes reused from other domains (`not_found`, `source_already_exported`, `recipient_not_whitelisted`,
 * `read_unavailable`) so the mapping `Record` is total and no path throws a raw HttpException ad hoc.
 */
export type WalletRotationReason =
  | 'not_found' // source/destination wallet not owned/absent → 404 WALLET_NOT_FOUND
  | 'source_invalid' // source not an embedded passkey wallet / no contract → 422 ROTATION_SOURCE_INVALID
  | 'source_already_exported' // source already drained/exported → 409 ALREADY_EXPORTED
  | 'destination_invalid' // destination not BYOW / no public key / == source → 422 ROTATION_DESTINATION_INVALID
  | 'destination_not_primary' // destination is not the current primary → 409 ROTATION_DESTINATION_NOT_PRIMARY
  | 'conflict' // an export or rotation is already active on the source → 409 ROTATION_CONFLICT
  | 'nothing_to_transfer' // source holds no non-zero fraction balances → 422 ROTATION_NOTHING_TO_TRANSFER
  | 'blocked_by_lockup' // source holds artist-retention fractions still locked → 422 ROTATION_BLOCKED_BY_LOCKUP
  | 'recipient_not_whitelisted' // destination absent from the on-chain KYC allowlist → 422 RECIPIENT_NOT_WHITELISTED
  | 'rotation_not_found' // rotation id not found / not owned by the caller → 404 ROTATION_NOT_FOUND
  | 'cannot_cancel' // cancel refused: an item is in-flight/confirmed → 409 ROTATION_CANNOT_CANCEL
  | 'read_unavailable'; // a FractionToken balance / allowlist read failed (RPC) → 503 HOLDINGS_UNAVAILABLE

export class WalletRotationError extends Error {
  constructor(readonly reason: WalletRotationReason) {
    super(`wallet rotation failed: ${reason}`);
    this.name = 'WalletRotationError';
  }
}
