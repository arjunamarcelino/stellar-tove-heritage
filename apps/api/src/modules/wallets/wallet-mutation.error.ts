/**
 * Domain error raised by the neutral wallets aggregate when an add/remove/set-primary of a bound wallet
 * fails (TOV-24 add/remove, TOV-25 set-primary). The wallets domain stays free of HTTP/ErrorCode concerns;
 * the calling surface (`MeWalletsService`) maps `reason` to the appropriate HTTP status + errorCode. Sibling
 * of {@link WalletBindError} (embedded-passkey aggregate bind).
 */
export type WalletMutationReason =
  | 'already_bound' // pubkey bound to another collector → 409 WALLET_ALREADY_BOUND
  | 'challenge_consumed' // the SEP-10 challenge was already used → 401 AUTH_CHALLENGE_ALREADY_USED
  | 'kind_not_supported' // cannot remove/promote an embedded wallet here → 422 WALLET_KIND_NOT_SUPPORTED
  | 'not_eligible_for_primary' // cannot set an exported wallet as primary → 409 WALLET_NOT_ELIGIBLE_FOR_PRIMARY (TOV-25)
  | 'not_found' // wallet id not found / not owned by the caller → 404 WALLET_NOT_FOUND
  | 'primary_cannot_be_removed'; // primary delete refused: no eligible sibling to promote → 409 PRIMARY_WALLET_CANNOT_BE_REMOVED (TOV-25)

export class WalletMutationError extends Error {
  constructor(readonly reason: WalletMutationReason) {
    super(`wallet mutation failed: ${reason}`);
    this.name = 'WalletMutationError';
  }
}
