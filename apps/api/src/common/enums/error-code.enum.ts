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

  // Wallet rotation / identity-stability transfer (TOV-33, FR-01.12). Move all fraction holdings from a
  // Collector's embedded passkey wallet (source) to their own BYOW settlement wallet (destination).
  ROTATION_BLOCKED_BY_LOCKUP = 'ROTATION_BLOCKED_BY_LOCKUP', // source holds artist-retention fractions still locked (422)
  ROTATION_CONFLICT = 'ROTATION_CONFLICT', // an export or rotation is already active on the source wallet (409)
  ROTATION_DESTINATION_NOT_PRIMARY = 'ROTATION_DESTINATION_NOT_PRIMARY', // destination is not the current primary (409)
  ROTATION_DESTINATION_INVALID = 'ROTATION_DESTINATION_INVALID', // destination not BYOW / no public key / == source (422)
  ROTATION_SOURCE_INVALID = 'ROTATION_SOURCE_INVALID', // source is not an embedded passkey wallet / no contract (422)
  ROTATION_NOTHING_TO_TRANSFER = 'ROTATION_NOTHING_TO_TRANSFER', // source holds no non-zero fraction balances (422)
  ROTATION_NOT_FOUND = 'ROTATION_NOT_FOUND', // rotation id not found / not owned by the caller (404)
  ROTATION_CANNOT_CANCEL = 'ROTATION_CANNOT_CANCEL', // cancel refused: an item is in-flight/confirmed (409)

  // Users
  USER_NOT_FOUND = 'USER_NOT_FOUND',

  // Handle uniqueness (TOV-26, FR-01.05). Pseudonymous collector handles on the users table.
  HANDLE_TAKEN = 'HANDLE_TAKEN', // canonical already claimed by another live collector (409) — AC literal
  HANDLE_FORMAT_INVALID = 'HANDLE_FORMAT_INVALID', // charset/length/leading-char/separator (422) — AC literal
  HANDLE_RESERVED = 'HANDLE_RESERVED', // reserved word (422) — AC literal

  // Collector public profile (TOV-27, FR-01.06). Read by current handle only; old handles are not aliases.
  COLLECTOR_NOT_FOUND = 'COLLECTOR_NOT_FOUND', // no live collector holds this handle (404)

  // Profile fields + avatar (TOV-30, FR-01.09). Field validation reuses VALIDATION_FAILED (422 + errors[]);
  // idempotency reuses IDEMPOTENCY_KEY_IN_FLIGHT/_MISMATCH. Note PROFILE_UPLOAD_MISSING (not _NOT_FOUND):
  // the _NOT_FOUND suffix is reserved for 404s, and this is a 422 (bytes never uploaded before commit).
  PROFILE_IMAGE_NOT_FOUND = 'PROFILE_IMAGE_NOT_FOUND', // image unknown / not owned by caller (404, no oracle)
  PROFILE_IMAGE_NOT_READY = 'PROFILE_IMAGE_NOT_READY', // activate before derivatives are ready (422)
  PROFILE_IMAGE_INVALID = 'PROFILE_IMAGE_INVALID', // not a supported still image / animated / corrupt (422)
  PROFILE_IMAGE_TOO_LARGE = 'PROFILE_IMAGE_TOO_LARGE', // uploaded bytes exceed the size cap (422)
  PROFILE_UPLOAD_MISSING = 'PROFILE_UPLOAD_MISSING', // commit before any bytes were uploaded (422)
  PROFILE_IMAGE_ALREADY_COMMITTED = 'PROFILE_IMAGE_ALREADY_COMMITTED', // commit on a non-pending row (409)
  PROFILE_TOO_MANY_UPLOADS = 'PROFILE_TOO_MANY_UPLOADS', // per-user non-terminal upload ceiling reached (409)
  PROFILE_COMMIT_BUSY = 'PROFILE_COMMIT_BUSY', // global commit concurrency cap reached — retry (503)
  PROFILE_STORAGE_UNAVAILABLE = 'PROFILE_STORAGE_UNAVAILABLE', // transient storage failure at commit — retry (503)

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

  // Fractionalization (TOV-233, FR-04.MVP.01). Admin-only per-artwork FractionToken deploy.
  ARTWORK_ALREADY_FRACTIONALIZED = 'ARTWORK_ALREADY_FRACTIONALIZED', // a token was already deployed (409) — AC literal
  ARTWORK_FRACTIONALIZATION_IN_PROGRESS = 'ARTWORK_FRACTIONALIZATION_IN_PROGRESS', // a deploy is already underway (409)
  ARTWORK_NOT_FRACTIONALIZABLE = 'ARTWORK_NOT_FRACTIONALIZABLE', // artwork not in a fractionalizable (verified) state (409)
  ARTIST_NO_PRIMARY_WALLET = 'ARTIST_NO_PRIMARY_WALLET', // artwork owner has no primary settlement wallet (422)

  // Offerings (TOV-152, FR-05.01). Admin plans a primary Offering for a fractionalized artwork.
  // OFFERING_ARTWORK_NOT_FRACTIONALIZED is deliberately OFFERING_-prefixed to avoid collision with the
  // existing ARTWORK_NOT_FRACTIONALIZABLE above (one letter apart — a mis-selection hazard in a money path).
  OFFERING_WINDOW_INVALID = 'OFFERING_WINDOW_INVALID', // window_open_at >= window_close_at (422) — AC literal
  OFFERING_BAND_INVALID = 'OFFERING_BAND_INVALID', // low<=0 / high<=0 / low>=high / high>2^96-1 (422)
  OFFERING_NO_FLOAT = 'OFFERING_NO_FLOAT', // public_float <= 0, nothing to sell (422)
  OFFERING_ARTWORK_NOT_FRACTIONALIZED = 'OFFERING_ARTWORK_NOT_FRACTIONALIZED', // no deployed fraction_contract / float not computable (409)
  OFFERING_ALREADY_ACTIVE = 'OFFERING_ALREADY_ACTIVE', // artwork already has a non-terminal offering (409)

  // Offering multi-sig approval + escrow deploy (TOV-154, FR-05.02).
  OFFERING_NOT_FOUND = 'OFFERING_NOT_FOUND', // no such offering (404)
  OFFERING_NOT_PLANNED = 'OFFERING_NOT_PLANNED', // approve valid only from status='planned' (409)
  OFFERING_APPROVAL_NOT_A_SIGNER = 'OFFERING_APPROVAL_NOT_A_SIGNER', // admin not in the approval roster (403)
  OFFERING_APPROVAL_IN_PROGRESS = 'OFFERING_APPROVAL_IN_PROGRESS', // escrow deploy already claimed/done for this offering (409)

  // Offering bid submission (TOV-156, FR-05.03). Whitelisted Collector escrows price×count USDC via the
  // escrow contract's passkey-signed submit_bid (relayed, async). Band/whitelist/window are the backend's
  // job — the contract only checks price>0/count>0 + Status::Open + its own DuplicateBid guard.
  BID_NOT_WHITELISTED = 'BID_NOT_WHITELISTED', // collector kyc_status != 'whitelisted' (403)
  BID_BELOW_LOW_PRICE = 'BID_BELOW_LOW_PRICE', // price < band low (422) — AC literal
  BID_ABOVE_HIGH_PRICE = 'BID_ABOVE_HIGH_PRICE', // price > band high (422)
  BID_COUNT_EXCEEDS_FLOAT = 'BID_COUNT_EXCEEDS_FLOAT', // count > public_float (422)
  BID_COST_EXCEEDS_LIMIT = 'BID_COST_EXCEEDS_LIMIT', // price*count over the per-bid ceiling / out of range (422)
  BID_INSUFFICIENT_BALANCE = 'BID_INSUFFICIENT_BALANCE', // USDC balance < price×count (422; body adds required/available)
  BID_ALREADY_ACTIVE = 'BID_ALREADY_ACTIVE', // collector already has an active bid on this offering (409)
  OFFERING_NOT_OPEN = 'OFFERING_NOT_OPEN', // offering.status != 'opened' (409)
  OFFERING_WINDOW_NOT_OPEN = 'OFFERING_WINDOW_NOT_OPEN', // now < window_open_at (422)
  OFFERING_WINDOW_CLOSED = 'OFFERING_WINDOW_CLOSED', // now >= window_close_at (422)
  BID_SIGNATURE_REQUIRED = 'BID_SIGNATURE_REQUIRED', // missing/empty passkey assertion (422, defense-in-depth)
  BID_SIGNATURE_INVALID = 'BID_SIGNATURE_INVALID', // passkey assertion integrity/binding failure (422, opaque)
  BID_CHALLENGE_EXPIRED = 'BID_CHALLENGE_EXPIRED', // signature/tx expired before submit — re-prepare (422, retryable)
  BID_ESCROW_REJECTED = 'BID_ESCROW_REJECTED', // escrow simulate/apply rejected (bad state, consumed nonce, revert) (422)
  BID_UNAVAILABLE = 'BID_UNAVAILABLE', // relayer/RPC transiently unavailable — retry (503)

  // Offering bid cancel + USDC refund (TOV-158, FR-05.04). Bidder passkey-signs cancel_bid; the escrow
  // contract refunds price×count USDC (escrow → bidder). Cancel is NOT whitelist-gated (a de-whitelisted
  // collector must still reclaim escrowed funds); authz = bid ownership + on-chain require_auth.
  BID_NOT_FOUND = 'BID_NOT_FOUND', // caller has no active bid on this offering (404, no existence oracle)
  BID_NOT_CANCELABLE = 'BID_NOT_CANCELABLE', // bid not in a cancelable (escrowed) state, or a cancel is already in flight (409)
  BID_CANCEL_REJECTED = 'BID_CANCEL_REJECTED', // cancel simulate/apply rejected (offering closed on-chain, etc.) (422)

  // Uniform-price clearing + settlement (TOV-160, FR-05.05). Admin closes bidding + settles a fully-
  // subscribed offering; the async worker calls close_and_settle and records the clearing snapshot.
  OFFERING_TOO_MANY_BIDS = 'OFFERING_TOO_MANY_BIDS', // active bids >= MAX_BIDS_PER_OFFERING (submit) — on-chain atomic-settle ceiling (409)
  OFFERING_WINDOW_STILL_OPEN = 'OFFERING_WINDOW_STILL_OPEN', // settle before window_close_at (409)
  OFFERING_HAS_INFLIGHT_BIDS = 'OFFERING_HAS_INFLIGHT_BIDS', // a submitted/canceling bid exists — book not final (409)
  OFFERING_UNDERSUBSCRIBED = 'OFFERING_UNDERSUBSCRIBED', // Σ escrowed count < public_float — cannot settle (422)
  OFFERING_ESCROW_UNAVAILABLE = 'OFFERING_ESCROW_UNAVAILABLE', // escrow not deployed for this offering (409 — stable precondition)
  OFFERING_ALREADY_SETTLED = 'OFFERING_ALREADY_SETTLED', // offering.status = 'settled' (409)
  OFFERING_SETTLE_IN_PROGRESS = 'OFFERING_SETTLE_IN_PROGRESS', // a settlement is already latched/running (409)

  // Fraction holdings read (TOV-237, FR-04.MVP.04). Collector's on-chain fraction balances.
  HOLDINGS_UNAVAILABLE = 'HOLDINGS_UNAVAILABLE', // a FractionToken balance read failed (RPC) → 503

  // KYC allowlist admin (TOV-235, FR-04.MVP.03a). Admin batch add/remove of Collector wallets on-chain.
  // (Validation reuses VALIDATION_FAILED; idempotency reuses IDEMPOTENCY_KEY_IN_FLIGHT/_MISMATCH.)
  KYC_ALLOWLIST_ALL_NOOP = 'KYC_ALLOWLIST_ALL_NOOP', // every item was already in the requested state (409)

  // Marketplace RFQ creation (TOV-172, FR-06.01). Whitelisted Collector requests a quote on a
  // fractionalized artwork. Pure DB write; the balance check is soft-warn only (never blocks).
  // RFQ_ARTWORK_NOT_FRACTIONALIZED is deliberately RFQ_-prefixed (like OFFERING_ARTWORK_NOT_FRACTIONALIZED)
  // to avoid collision with ARTWORK_NOT_FRACTIONALIZABLE — a mis-selection hazard. Validation reuses
  // VALIDATION_FAILED; idempotency reuses IDEMPOTENCY_KEY_IN_FLIGHT/_MISMATCH; missing artwork = ARTWORK_NOT_FOUND.
  RFQ_NOT_WHITELISTED = 'RFQ_NOT_WHITELISTED', // collector kyc_status != 'whitelisted' (403)
  RFQ_TOO_MANY_ACTIVE = 'RFQ_TOO_MANY_ACTIVE', // collector already at the MAX_ACTIVE_OPEN_RFQS ceiling (422)
  RFQ_ARTWORK_NOT_FRACTIONALIZED = 'RFQ_ARTWORK_NOT_FRACTIONALIZED', // no deployed fraction_contract (422) — AC literal
  RFQ_INVALID_PRICE = 'RFQ_INVALID_PRICE', // max_price outside [1, 2^96-1] (422)
  RFQ_AMOUNT_OVERFLOW = 'RFQ_AMOUNT_OVERFLOW', // max_price × count > 2^127-1 (422)

  // Marketplace notifications inbox (TOV-174, FR-06.02). Owner-scoped RFQ fan-out notifications.
  NOTIFICATION_NOT_FOUND = 'NOTIFICATION_NOT_FOUND', // notification missing / soft-deleted / not the caller's (404, no oracle)

  // Marketplace Quote submission (TOV-175, FR-06.03). A whitelisted holder offers to SELL on an open RFQ.
  // Own QUOTE_-prefixed namespace (money path — avoids mis-selection with RFQ_/BID_). Validation reuses
  // VALIDATION_FAILED; idempotency reuses IDEMPOTENCY_KEY_IN_FLIGHT/_MISMATCH.
  QUOTE_NOT_WHITELISTED = 'QUOTE_NOT_WHITELISTED', // holder kyc_status != 'whitelisted' (403)
  QUOTE_RFQ_NOT_FOUND = 'QUOTE_RFQ_NOT_FOUND', // rfq missing / soft-deleted (404, no existence oracle)
  QUOTE_RFQ_NOT_OPEN = 'QUOTE_RFQ_NOT_OPEN', // rfq.status != 'open', or its fraction contract is not deployed (422)
  QUOTE_RFQ_EXPIRED = 'QUOTE_RFQ_EXPIRED', // rfq.expires_at <= now (422; an open RFQ can outlive expiry, no sweeper)
  QUOTE_ON_OWN_RFQ = 'QUOTE_ON_OWN_RFQ', // holder == rfq.collector_sub — can't quote your own RFQ (422)
  QUOTE_INVALID_PRICE = 'QUOTE_INVALID_PRICE', // price outside [1, 2^96-1] (422) — the STROOPS_RE DTO admits >2^96-1
  QUOTE_AMOUNT_OVERFLOW = 'QUOTE_AMOUNT_OVERFLOW', // price × count > 2^127-1 (422)
  QUOTE_INVALID_VALIDITY = 'QUOTE_INVALID_VALIDITY', // valid_until <= now (422)
  QUOTE_NO_SETTLEMENT_WALLET = 'QUOTE_NO_SETTLEMENT_WALLET', // holder has no primary settlement wallet to sell from (422)
  QUOTE_INSUFFICIENT_FREE_BALANCE = 'QUOTE_INSUFFICIENT_FREE_BALANCE', // free (onchain − locked) < count (422; body adds requiredCount/freeBalance)
  QUOTE_ALREADY_OPEN = 'QUOTE_ALREADY_OPEN', // holder already has an open quote on this rfq (409)
  QUOTE_BALANCE_UNAVAILABLE = 'QUOTE_BALANCE_UNAVAILABLE', // FractionToken balance read failed/timed out (503, fail-closed)

  // Marketplace seller-authorize (TOV-177, FR-06.04): the seller pre-signs their quote for atomic settlement.
  QUOTE_NOT_FOUND = 'QUOTE_NOT_FOUND', // quote missing / not the caller's (404, no existence oracle)
  QUOTE_NOT_AUTHORIZABLE = 'QUOTE_NOT_AUTHORIZABLE', // quote not open / past validUntil / buyer not settlement-ready (422)
  QUOTE_OVER_AUTHORIZED = 'QUOTE_OVER_AUTHORIZED', // free (onchain − authorized) < count (422; body adds requiredCount/freeBalance)
  QUOTE_AUTH_INVALID = 'QUOTE_AUTH_INVALID', // the seller's passkey assertion failed verification (422)

  // Marketplace buyer-accept + atomic settlement (TOV-177, FR-06.04+06.05).
  ACCEPT_NOT_RFQ_BUYER = 'ACCEPT_NOT_RFQ_BUYER', // caller is not the RFQ creator (403)
  ACCEPT_RFQ_NOT_OPEN = 'ACCEPT_RFQ_NOT_OPEN', // rfq.status != 'open' (422)
  ACCEPT_QUOTE_NOT_ACCEPTABLE = 'ACCEPT_QUOTE_NOT_ACCEPTABLE', // quote not open / wrong rfq / past validUntil (422)
  ACCEPT_QUOTE_NOT_AUTHORIZED = 'ACCEPT_QUOTE_NOT_AUTHORIZED', // the seller has not authorized this quote (422)
  ACCEPT_NOT_WHITELISTED = 'ACCEPT_NOT_WHITELISTED', // buyer or seller kyc_status != 'whitelisted' (403)
  ACCEPT_INSUFFICIENT_USDC = 'ACCEPT_INSUFFICIENT_USDC', // buyer USDC < gross (422; body adds requiredStroops/availableStroops)
  ACCEPT_CHALLENGE_EXPIRED = 'ACCEPT_CHALLENGE_EXPIRED', // buyer signature expired before submit — re-prepare (422)
  ACCEPT_SETTLEMENT_UNAVAILABLE = 'ACCEPT_SETTLEMENT_UNAVAILABLE', // relayer/RPC transiently unavailable (503)
  TRADE_ALREADY_IN_FLIGHT = 'TRADE_ALREADY_IN_FLIGHT', // a pending trade already exists on this rfq (409)
  TRADE_NOT_FOUND = 'TRADE_NOT_FOUND', // the buyer has no trade on this rfq (404, no existence oracle)

  // Artwork timeline (TOV-191, FR-08.02/08.03). Public cursor-paginated provenance timeline.
  // Artwork visibility reuses ARTWORK_NOT_FOUND (no existence oracle); this is the only new code.
  TIMELINE_INVALID_CURSOR = 'TIMELINE_INVALID_CURSOR', // malformed / tampered / oversized keyset cursor (400)

  // Artists
  ARTIST_NOT_FOUND = 'ARTIST_NOT_FOUND',

  // KYC submission (TOV-28, FR-01.07). Authenticated multipart submission of encrypted identity documents.
  JURISDICTION_NOT_ELIGIBLE = 'JURISDICTION_NOT_ELIGIBLE', // claimed_jurisdiction not on the launch allowlist (422) — AC literal
  KYC_ALREADY_PENDING = 'KYC_ALREADY_PENDING', // a submission is already under review (409) — AC literal
  KYC_ALREADY_APPROVED = 'KYC_ALREADY_APPROVED', // collector already approved; no resubmit (409)
  KYC_MISSING_DOCUMENT = 'KYC_MISSING_DOCUMENT', // one of the 4 required document fields is absent (422)
  KYC_UNEXPECTED_DOCUMENT = 'KYC_UNEXPECTED_DOCUMENT', // unknown/extra or duplicate document field (422)
  KYC_UNSUPPORTED_MEDIA_TYPE = 'KYC_UNSUPPORTED_MEDIA_TYPE', // not JPEG/PNG/PDF, or declared≠sniffed (422)
  KYC_FILE_TOO_LARGE = 'KYC_FILE_TOO_LARGE', // a document exceeds the per-file size cap (422)
  KYC_FILE_EMPTY = 'KYC_FILE_EMPTY', // a document is 0 bytes (422)

  // General
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
}
