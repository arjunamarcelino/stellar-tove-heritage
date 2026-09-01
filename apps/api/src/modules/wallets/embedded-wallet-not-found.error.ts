/**
 * Domain error raised when a caller has no live embedded-passkey wallet (or its bound credential is
 * missing). The neutral wallets domain stays free of HTTP/ErrorCode concerns; the calling surface
 * (the transfer controller/service) maps this to WALLET_NOT_FOUND.
 */
export class EmbeddedWalletNotFoundError extends Error {
  constructor(readonly userId: string) {
    super('no live embedded-passkey wallet for user');
    this.name = 'EmbeddedWalletNotFoundError';
  }
}
