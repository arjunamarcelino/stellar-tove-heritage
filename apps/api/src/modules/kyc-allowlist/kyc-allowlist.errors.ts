/** Retryable throttle from the RPC (TRY_AGAIN_LATER) or an unavailable read. */
export class KycAllowlistThrottledError extends Error {}

/**
 * The wallet is not a valid Stellar account (`G…`) or Soroban contract (`C…`) StrKey — checksum/shape, or a
 * disallowed kind such as muxed/`M…` (TOV-243). Surfaces as a per-item failure.
 */
export class KycAllowlistBadAddressError extends Error {}
