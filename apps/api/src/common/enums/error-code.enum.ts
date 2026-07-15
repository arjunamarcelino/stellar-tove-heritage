export enum ErrorCode {
  // Auth
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_EXPIRED_TOKEN = 'AUTH_EXPIRED_TOKEN',
  AUTH_INVALID_REFRESH_TOKEN = 'AUTH_INVALID_REFRESH_TOKEN',
  AUTH_EMAIL_CONFLICT = 'AUTH_EMAIL_CONFLICT',

  // Auth (SEP-10 wallet)
  AUTH_CHALLENGE_NOT_FOUND = 'AUTH_CHALLENGE_NOT_FOUND',
  AUTH_CHALLENGE_EXPIRED = 'AUTH_CHALLENGE_EXPIRED',
  AUTH_CHALLENGE_ALREADY_USED = 'AUTH_CHALLENGE_ALREADY_USED',
  AUTH_SIGNATURE_INVALID = 'AUTH_SIGNATURE_INVALID',

  // Auth (embedded passkey / smart-wallet registration).
  // The challenge classifications reuse the SEP-10 AUTH_CHALLENGE_* codes above.
  AUTH_PASSKEY_VERIFICATION_FAILED = 'AUTH_PASSKEY_VERIFICATION_FAILED',
  // Un-prefixed by design: the FR-01.02a acceptance criteria mandate this literal value.
  PASSKEY_ALREADY_BOUND = 'PASSKEY_ALREADY_BOUND',
  WALLET_DEPLOY_FAILED = 'WALLET_DEPLOY_FAILED',

  // Passkey-signed transfer (TOV-22, relayer authority constraint). The relayer builds + pays but
  // never submits a wallet transfer without a valid user passkey signature attached.
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND', // caller has no live embedded wallet
  TRANSFER_SIGNATURE_REQUIRED = 'TRANSFER_SIGNATURE_REQUIRED', // missing/empty passkey assertion (defense-in-depth)
  TRANSFER_SIGNATURE_INVALID = 'TRANSFER_SIGNATURE_INVALID', // integrity/binding/normalization/UV/origin/fee failure
  TRANSFER_EXPIRED = 'TRANSFER_EXPIRED', // signatureExpirationLedger passed; FE must re-build
  TRANSFER_SIMULATION_FAILED = 'TRANSFER_SIMULATION_FAILED', // simulate failed (balance, consumed nonce/replay, undeployed)
  TRANSFER_FAILED = 'TRANSFER_FAILED', // accepted but failed on apply
  TRANSFER_UNAVAILABLE = 'TRANSFER_UNAVAILABLE', // RPC timeout / relayer underfunded

  // Multi-wallet binding (TOV-24, FR-01.03). Authenticated add/list/remove of wallets bound to a Collector.
  WALLET_ALREADY_BOUND = 'WALLET_ALREADY_BOUND', // pubkey already bound to another collector (409) — AC-mandated literal
  WALLET_KIND_NOT_SUPPORTED = 'WALLET_KIND_NOT_SUPPORTED', // cannot remove/promote an embedded wallet here — use export (422)
  IDEMPOTENCY_KEY_IN_FLIGHT = 'IDEMPOTENCY_KEY_IN_FLIGHT', // a request with this key is still processing (409)
  IDEMPOTENCY_KEY_MISMATCH = 'IDEMPOTENCY_KEY_MISMATCH', // key reused with a different request body (422)

  // Primary settlement wallet (TOV-25, FR-01.04). Set-primary + delete auto-promote.
  PRIMARY_WALLET_CANNOT_BE_REMOVED = 'PRIMARY_WALLET_CANNOT_BE_REMOVED', // primary delete refused: no eligible sibling to promote (409) — AC-mandated literal
  WALLET_NOT_ELIGIBLE_FOR_PRIMARY = 'WALLET_NOT_ELIGIBLE_FOR_PRIMARY', // set-primary on an exported wallet (409)

  // Export embedded wallet (TOV-40). Two-phase drain of an embedded passkey wallet's holdings
  // (USDC + each Soroban fraction) to a KYC-allowlisted self-custody address, then mark exported.
  EXPORT_NOT_AVAILABLE = 'EXPORT_NOT_AVAILABLE', // BYOW / empty / non-embedded wallet (export not possible)
  ALREADY_EXPORTED = 'ALREADY_EXPORTED', // wallet already exported (the one-way latch) — distinct copy from above
  RECIPIENT_NOT_WHITELISTED = 'RECIPIENT_NOT_WHITELISTED', // target address absent from the KYC allowlist
  EXPORT_NOT_FOUND = 'EXPORT_NOT_FOUND', // export id not found / not owned by the caller

  // Users
  USER_NOT_FOUND = 'USER_NOT_FOUND',

  // Handle uniqueness (TOV-26, FR-01.05). Pseudonymous collector handles on the users table.
  HANDLE_TAKEN = 'HANDLE_TAKEN', // canonical already claimed by another live collector (409) — AC literal
  HANDLE_FORMAT_INVALID = 'HANDLE_FORMAT_INVALID', // charset/length/leading-char/separator (422) — AC literal
  HANDLE_RESERVED = 'HANDLE_RESERVED', // reserved word (422) — AC literal

  // Collector public profile (TOV-27, FR-01.06). Read by current handle only; old handles are not aliases.
  COLLECTOR_NOT_FOUND = 'COLLECTOR_NOT_FOUND', // no live collector holds this handle (404)

  // Validation
  VALIDATION_FAILED = 'VALIDATION_FAILED',

  // Stages
  STAGE_NOT_FOUND = 'STAGE_NOT_FOUND',
  STAGE_ORDER_CONFLICT = 'STAGE_ORDER_CONFLICT',

  // Missions
  MISSION_NOT_FOUND = 'MISSION_NOT_FOUND',
  MISSION_ORDER_CONFLICT = 'MISSION_ORDER_CONFLICT',
  MISSION_STAGE_NOT_FOUND = 'MISSION_STAGE_NOT_FOUND',

  // Submissions
  SUBMISSION_NOT_FOUND = 'SUBMISSION_NOT_FOUND',
  SUBMISSION_ALREADY_ACCEPTED = 'SUBMISSION_ALREADY_ACCEPTED',
  SUBMISSION_ALREADY_PENDING = 'SUBMISSION_ALREADY_PENDING',
  SUBMISSION_STAGE_NOT_ACTIVE = 'SUBMISSION_STAGE_NOT_ACTIVE',
  SUBMISSION_EVIDENCE_MISMATCH = 'SUBMISSION_EVIDENCE_MISMATCH',
  SUBMISSION_INVALID_REVIEW = 'SUBMISSION_INVALID_REVIEW',

  // Artworks
  ARTWORK_NOT_FOUND = 'ARTWORK_NOT_FOUND',

  // Artists
  ARTIST_NOT_FOUND = 'ARTIST_NOT_FOUND',

  // General
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
}
