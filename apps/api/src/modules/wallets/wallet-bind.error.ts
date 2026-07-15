/**
 * Domain error raised when binding an embedded-passkey wallet aggregate fails. The
 * neutral wallets domain stays free of HTTP/ErrorCode concerns; the calling surface
 * (PasskeyService) maps `reason` to the appropriate HTTP status + errorCode.
 */
export type WalletBindReason = 'challenge_consumed' | 'passkey_already_bound' | 'email_conflict';

export class WalletBindError extends Error {
  constructor(readonly reason: WalletBindReason) {
    super(`embedded passkey wallet bind failed: ${reason}`);
    this.name = 'WalletBindError';
  }
}
