import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/browser';

// Re-exported so the passkey/wallet layers import these library types from the single contract
// module. Registration types drive enrollment; the Request/Authentication pair drives the export
// signing ceremony (WebAuthn assertion).
export type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
};

export type WaitlistState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

export type RegisterState =
  | { status: 'idle' }
  | { status: 'success' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export type LoginState =
  | { status: 'idle' }
  | { status: 'success' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

// Internal server-only result — carries tokens between service and action, never serialized to client
export type LoginServiceResult =
  | { status: 'success'; accessToken: string; refreshToken: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export type ProfileResult =
  | {
      status: 'success';
      firstName: string;
      lastName: string;
      currentStage?: import('@/lib/services/auth').Stage | null;
    }
  | { status: 'error'; message: string };

// ── Wallet Connect ────────────────────────────────

export type ProviderId = 'freighter' | 'albedo';

export type ChallengeServiceErrorCode = 'RATE_LIMITED' | 'NETWORK_ERROR';

export type ChallengeServiceResult =
  | { status: 'success'; xdr: string; networkPassphrase: string }
  | { status: 'error'; code: ChallengeServiceErrorCode; message: string };

export type VerifyServiceErrorCode = 'AUTH_SIGNATURE_INVALID' | 'NETWORK_ERROR';

export type VerifyServiceResult =
  | { status: 'success'; accessToken: string; refreshToken: string }
  | { status: 'error'; code: VerifyServiceErrorCode; message: string };

export type WalletErrorCode =
  | 'EXTENSION_NOT_FOUND'
  | 'USER_CANCELLED'
  | 'NETWORK_MISMATCH'
  | 'POPUP_BLOCKED'
  | 'AUTH_CHALLENGE_EXPIRED'
  | 'AUTH_SIGNATURE_INVALID'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR';

export type WalletResult<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; code: WalletErrorCode; message: string };

export interface WalletProvider {
  getPublicKey(): Promise<WalletResult<string>>;
  signTransaction(xdr: string, networkPassphrase: string): Promise<WalletResult<string>>;
}

export type WalletConnectState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'signing'; xdr: string; networkPassphrase: string }
  | { status: 'error'; code: WalletErrorCode; message: string; retryable: boolean };

export type WalletChallengeResult =
  | { status: 'success'; xdr: string; networkPassphrase: string }
  | { status: 'error'; code: WalletErrorCode; message: string };

export type WalletVerifyResult =
  | { status: 'success' }
  | { status: 'error'; code: WalletErrorCode; message: string };

// ── Passkey Enrollment (TOV-37) ───────────────────
// See docs/plans/2026-07-02-feat-passkey-enrollment-ui-plan.md for the full contract.
// Backend contract confirmed by TOV-21: errors are keyed on the response `errorCode` (with an
// HTTP-status fallback); finish's 201 body is { accessToken, refreshToken }.
// (PublicKeyCredentialCreationOptionsJSON / RegistrationResponseJSON imported at top of file.)

// Browser-origin codes (from the @simplewebauthn/browser ceremony)
export type PasskeyWebAuthnErrorCode =
  | 'PASSKEY_CANCELLED' // NotAllowedError / ceremony aborted / timeout
  | 'PASSKEY_ALREADY_BOUND' // InvalidStateError — credential already on this device
  | 'PASSKEY_FAILED'; // other/unknown ceremony failure

// Backend-origin codes (from the Express API, keyed off the response `errorCode`), plus
// VALIDATION_ERROR raised by the action's own input validation before it delegates.
// CHALLENGE_EXPIRED / PASSKEY_VERIFICATION_FAILED require restarting from begin; WALLET_DEPLOY_FAILED
// and NETWORK_ERROR are safe to retry with the SAME finish payload (backend TOV-21 confirmed).
export type PasskeyServiceErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_CONFLICT'
  | 'PASSKEY_ALREADY_BOUND'
  | 'AUTH_CHALLENGE_EXPIRED'
  | 'PASSKEY_VERIFICATION_FAILED'
  | 'WALLET_DEPLOY_FAILED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR';

// Aggregate for the enroll state / UI
export type PasskeyErrorCode = PasskeyWebAuthnErrorCode | PasskeyServiceErrorCode | 'UNSUPPORTED';

// Browser wrapper result — never throws. `cancelled` is neither success nor error.
export type PasskeyRegisterResult =
  | { status: 'success'; response: RegistrationResponseJSON }
  | { status: 'cancelled' }
  | { status: 'error'; code: PasskeyWebAuthnErrorCode; message: string };

// Assertion (authentication) ceremony result — mirrors PasskeyRegisterResult for the export signing
// flow. NotAllowedError is opaque (cancel vs timeout vs no-credential are indistinguishable by
// design), so any of them collapses to `cancelled`; everything else is PASSKEY_FAILED.
export type PasskeyAssertionResult =
  | { status: 'success'; response: AuthenticationResponseJSON }
  | { status: 'cancelled' }
  | { status: 'error'; code: PasskeyWebAuthnErrorCode; message: string };

// begin: no tokens, options must reach the client — single result (no service/action split)
export type PasskeyBeginResult =
  | { status: 'success'; options: PublicKeyCredentialCreationOptionsJSON }
  | { status: 'error'; code: PasskeyServiceErrorCode; message: string };

// finish service result — server-only, carries tokens, never serialized to client. The 201 body is
// { accessToken, refreshToken, contractAddress } (TOV-21). contractAddress is the deployed Soroban
// smart-wallet address, returned on both the fresh-registration and idempotent-replay paths.
export type PasskeyFinishServiceResult =
  | {
      status: 'success';
      accessToken: string;
      refreshToken: string;
      contractAddress: string;
    }
  | { status: 'error'; code: PasskeyServiceErrorCode; message: string };

// finish action result — client-serializable: no tokens (they go to httpOnly cookies), but the
// public wallet address is fine to expose to the client.
export type PasskeyFinishResult =
  | { status: 'success'; contractAddress: string }
  | { status: 'error'; code: PasskeyServiceErrorCode; message: string };

export type PasskeyEnrollState =
  | { status: 'idle' }
  | { status: 'beginning' }
  | { status: 'signing' }
  | { status: 'finishing' }
  | { status: 'success'; contractAddress: string }
  | { status: 'error'; code: PasskeyErrorCode; message: string };

// finish takes only { email, attestationResponse } — the backend accepts no deviceName.
export interface FinishPasskeyInput {
  email: string;
  attestationResponse: RegistrationResponseJSON;
}
export interface UsePasskeyEnrollReturn {
  state: PasskeyEnrollState;
  enroll: (email: string) => Promise<void>;
  // Recovers from an error. On a retryable finish failure it re-submits the same attestation (bound
  // to the original email); when the challenge is no longer valid it restarts from begin using the
  // `email` argument (the live form value, so a corrected typo is honoured).
  retry: (email: string) => void;
  reset: () => void;
}
export interface PasskeySupport {
  supported: boolean;
}

// ── Wallet Export (TOV-23 / FR-01.02c) ────────────
// Contract confirmed by TOV-40 (2026-07-04). Export is N single-token transfers, each signed with
// its own per-item WebAuthn assertion; the server holds the txs and correlates by itemId at submit.
// No client-held tx and no client idempotency key (server nonce + one-way latch). Nothing here
// carries a secret, so there is no service/client result split (unlike passkey finish).

export type WalletKind = 'embedded_passkey' | 'byow';

// One wallet from GET /v1/me/wallets (owner-scoped). hasHoldings is intentionally absent — the guard
// gates on the export/status response instead. isPrimary/createdAt arrived with the TOV-24 surface
// (FR-01.03); both are optional so the list still parses against a backend that hasn't shipped them
// yet (forward-compat — see walletObjectSchema). isPrimary drives the ★ badge and set-primary
// eligibility; it is re-designated via setPrimaryWalletAction (FR-01.04, POST :id/primary) but stays
// server-authoritative — the app never writes it locally, it router.refresh()es. `undefined` primary
// ⇒ treated as unknown ⇒ not eligible/removable (see lib/wallet/eligibility.ts).
export interface WalletSummary {
  id: string;
  kind: WalletKind;
  address: string;
  exported: boolean;
  isPrimary?: boolean;
  createdAt?: string;
}

export type TokenKind = 'usdc' | 'fraction';

// One holding to transfer, from the export-begin response. amountScaled is a scaled-i128 decimal
// STRING (never a number); display value = amountScaled / 10^decimals. displayName is the on-chain
// symbol for MVP (artwork titles need the M04 registry). challenge is the per-item WebAuthn nonce;
// expiresAtLedger is a Stellar ledger sequence number, not a timestamp.
export interface ExportItem {
  itemId: string;
  tokenContract: string;
  tokenKind: TokenKind;
  amountScaled: string;
  decimals: number;
  assetCode: string;
  displayName: string;
  challenge: string;
  expiresAtLedger: number;
}

export interface ExportBeginData {
  exportId: string;
  targetAddress: string;
  credentialId: string;
  transports: string | null;
  rpId: string;
  items: ExportItem[];
}

// The signed material the client returns per item (extracted from the assertion's `response`).
export interface SignedExportItem {
  itemId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export type ExportState = 'none' | 'pending' | 'submitting' | 'confirmed' | 'failed';
export type ExportItemStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface ExportItemStatusDetail {
  tokenContract: string;
  tokenKind: TokenKind;
  status: ExportItemStatus;
  txHash?: string;
  // Display fields correlated client-side from the export-begin items (by tokenContract), so the
  // partial/success screens can show "USDC 10.00" / the fraction name — the status endpoint itself
  // carries only tokenContract/tokenKind/status/txHash (TOV-40).
  displayName?: string;
  assetCode?: string;
  amountScaled?: string;
  decimals?: number;
}

// submit returns the accepted state ('submitting'); the hook then reconciles via the status endpoint,
// so only `state` is consumed here (the per-item detail is read from status, not submit — todo 072).
export interface ExportSubmitData {
  state: ExportState;
}

// GET .../export/status — reconciliation, stateless / cold-session safe. 'confirmed' is authoritative
// ("did it move"); treat 'submitting' like 'pending' (in-flight, never blind-resubmit).
export interface ExportStatusData {
  exportId: string | null;
  state: ExportState;
  selfCustodyAddress?: string;
  items: ExportItemStatusDetail[];
}

// Error taxonomy. Backend-origin codes are mapped from the response `errorCode`; NETWORK_ERROR /
// SESSION_EXPIRED / SERVER_ERROR are HTTP-status fallbacks. TRANSFER_* / EXPORT_NOT_FOUND arrive on
// the submit path (per-item settlement failures).
export type WalletExportErrorCode =
  | 'VALIDATION_FAILED'
  | 'RECIPIENT_NOT_WHITELISTED'
  | 'EXPORT_NOT_AVAILABLE'
  | 'ALREADY_EXPORTED'
  | 'WALLET_NOT_FOUND'
  | 'EXPORT_NOT_FOUND'
  | 'TRANSFER_SIGNATURE_INVALID'
  | 'TRANSFER_EXPIRED'
  | 'TRANSFER_SIMULATION_FAILED'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_UNAVAILABLE'
  | 'PASSKEY_FAILED' // client-side signing ceremony failure (not a backend code)
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR';

// Generic HTTP-status-derived error codes (shared fallback across services). A subset of
// WalletExportErrorCode, so export services can widen to it; listWallets uses it directly rather than
// inheriting the full export taxonomy it can't produce.
export type StatusFallbackCode =
  | 'NETWORK_ERROR'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'WALLET_NOT_FOUND'
  | 'SERVER_ERROR';

export type ListWalletsResult =
  | { status: 'success'; wallets: WalletSummary[] }
  | { status: 'error'; code: StatusFallbackCode; message: string };

// ── Wallet management (TOV-24 / FR-01.03) ─────────
// Add a BYOW wallet (2-step SEP-10: challenge → client sign → submit with an Idempotency-Key) and
// remove a non-primary BYOW wallet (DELETE). Distinct from walletConnect.ts (SEP-10 *login*, mints a
// session) and walletExport.ts (embedded offboarding). Codes are mapped from the response `errorCode`;
// SESSION_EXPIRED / RATE_LIMITED / NETWORK_ERROR / SERVER_ERROR are HTTP-status fallbacks.
// The backend splits the idempotency conflict into two 1:1 codes (TOV-24 PR #26): 409
// IDEMPOTENCY_KEY_IN_FLIGHT (same key still processing → retry-send) and 422 IDEMPOTENCY_KEY_MISMATCH
// (same key, different body → restart with a fresh key). We branch on these codes directly.
export type AddWalletErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_SIGNATURE_INVALID'
  | 'AUTH_CHALLENGE_NOT_FOUND'
  | 'AUTH_CHALLENGE_EXPIRED'
  | 'AUTH_CHALLENGE_ALREADY_USED'
  | 'WALLET_ALREADY_BOUND'
  | 'IDEMPOTENCY_KEY_IN_FLIGHT'
  | 'IDEMPOTENCY_KEY_MISMATCH'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

export type RemoveWalletErrorCode =
  | 'WALLET_NOT_FOUND'
  | 'PRIMARY_WALLET_CANNOT_BE_REMOVED'
  | 'WALLET_KIND_NOT_SUPPORTED'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

export type AddWalletChallengeResult =
  | { status: 'success'; challengeTxXdr: string; networkPassphrase: string }
  | { status: 'error'; code: AddWalletErrorCode; message: string };

export type AddWalletResult =
  | { status: 'success'; wallet: WalletSummary }
  | { status: 'error'; code: AddWalletErrorCode; message: string };

// Recovery the hook offers on an add error: restart (fetch a new challenge → new key), retry-send
// (resubmit the same signed body + same key, e.g. after a transient network/in-flight conflict), or
// terminal (no retry — already bound / session expired).
export type WalletAddRecovery = 'restart' | 'retry-send' | 'terminal';

// useWalletAdd state machine. Each in-flight status maps to a distinct wait the dialog reflects;
// readyToSign holds the challenge until the user clicks Sign (the provider popup must fire from a
// gesture, not a mount effect).
export type WalletAddState =
  | { status: 'idle' }
  | { status: 'connecting' } // provider getPublicKey in flight
  | { status: 'challenging' } // POST /me/wallets/challenge in flight
  | { status: 'readyToSign'; challengeTxXdr: string; networkPassphrase: string }
  | { status: 'signing' } // provider signTransaction in flight
  | { status: 'submitting' } // POST /me/wallets in flight
  | { status: 'success'; wallet: WalletSummary }
  | { status: 'error'; message: string; recovery: WalletAddRecovery };

// TOV-25 changed DELETE /me/wallets/:id from 204 to 200 + { deletedId, newPrimaryWalletId }. When the
// deleted wallet was the primary, the backend auto-promotes the oldest eligible BYOW sibling and
// returns its id here; it is null when a non-primary wallet was deleted. The web app keeps the
// promote-first UX (the primary isn't directly removable), so in practice this is always null for our
// deletes — router.refresh() remains authoritative; the field is contract-accurate and ready if a
// future flow deletes the primary directly.
export type RemoveWalletResult =
  | { status: 'success'; newPrimaryWalletId: string | null }
  | { status: 'error'; code: RemoveWalletErrorCode; message: string };

// ── Set primary wallet (TOV-42 / FR-01.04) ────────
// Promote a wallet to primary: POST /v1/me/wallets/:id/primary (no body, no Idempotency-Key —
// naturally idempotent; re-setting the current primary is a 200 no-op). Codes are mapped from the
// response `errorCode`; SESSION_EXPIRED / RATE_LIMITED / NETWORK_ERROR / SERVER_ERROR are HTTP-status
// fallbacks. VALIDATION_FAILED is intentionally absent — the id is uuid-validated in the action and
// the 400 status fallback collapses to SERVER_ERROR (mirrors removeStatusFallback).
export type SetPrimaryWalletErrorCode =
  | 'WALLET_NOT_FOUND' // 404 (unknown / not owned / soft-deleted)
  | 'WALLET_KIND_NOT_SUPPORTED' // 422 (target is an active embedded wallet)
  | 'WALLET_NOT_ELIGIBLE_FOR_PRIMARY' // 409 (target is exported)
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

// Success carries no payload: the 200 body is the promoted wallet, but the DEMOTED old primary isn't
// in it, so the panel router.refresh()es to re-read the whole list rather than trust a single DTO.
export type SetPrimaryWalletResult =
  | { status: 'success' }
  | { status: 'error'; code: SetPrimaryWalletErrorCode; message: string };

export type ExportBeginResult =
  | { status: 'success'; data: ExportBeginData }
  | { status: 'error'; code: WalletExportErrorCode; message: string };

export type ExportSubmitResult =
  | { status: 'success'; data: ExportSubmitData }
  | { status: 'error'; code: WalletExportErrorCode; message: string };

export type ExportStatusResult =
  | { status: 'success'; data: ExportStatusData }
  | { status: 'error'; code: WalletExportErrorCode; message: string };

// Client state machine for the export wizard (useWalletExport). Two axes collapsed into one union:
// the wizard step (educating/enteringAddress/confirming) and the async phase (checking/signing/
// settling/reconciling/…). `settlementUnknown` is the load-bearing safe state — reconcile, never
// blind-resubmit. `partial` reflects the non-atomic N-transfer reality (some items moved, some not).
// By construction `error` always means nothing moved — an outcome where assets moved routes to
// `partial`, and an unknown outcome routes to `settlementUnknown` (todo 072).
export type WalletExportState =
  | { status: 'idle' }
  | { status: 'educating' }
  | { status: 'enteringAddress'; inlineError?: string }
  | { status: 'checkingAddress' }
  | { status: 'confirming'; data: ExportBeginData }
  | { status: 'signing'; data: ExportBeginData; signedCount: number }
  | { status: 'settling' }
  | { status: 'reconciling' }
  | { status: 'settlementUnknown' }
  | { status: 'success'; selfCustodyAddress?: string; items: ExportItemStatusDetail[] }
  | { status: 'partial'; items: ExportItemStatusDetail[] }
  | { status: 'error'; code: WalletExportErrorCode; message: string };

export interface UseWalletExportReturn {
  state: WalletExportState;
  start: () => void; // idle → educating
  acknowledgeEducation: () => void; // educating → enteringAddress
  submitAddress: (targetAddress: string) => Promise<void>; // → checkingAddress → confirming | inline error
  backToAddress: () => void; // confirming → enteringAddress (discards the fetched export/challenges)
  confirmAndSign: () => Promise<void>; // confirming → per-item signing → settling → reconciling → terminal
  reset: () => void;
}

// ── Handle Picker (TOV-43 / FR-01.05) ─────────────
// A required post-registration onboarding step: pick a unique public @handle. One union PER OPERATION
// (the exhaustive Record<Code, boolean> passthrough in the service is keyed on the commit union, so a
// shared union would break "fails to compile until classified"). Casing is preserved (uniqueness is
// case-insensitive; the backend stores the lowercase canonical form).
//
// Backend contract (TOV-26): the availability CHECK is a PUBLIC, tokenless GET called DIRECTLY from the
// browser (per-IP throttle only works when the backend sees the real client IP — routing it through a
// Server Action would collapse the budget onto the Next egress IP). Commit + read stay server-side.

// The check's wire enum, verbatim (GET /v1/handles/check → { available, reason? }).
export type CheckHandleReason = 'taken' | 'reserved' | 'invalid_format';

// Transport errors the client-side check can surface (always-200 endpoint → only throttle/transport).
export type CheckHandleErrorCode = 'RATE_LIMITED' | 'NETWORK_ERROR' | 'SERVER_ERROR';

// Commit codes (POST /v1/me/handle). HANDLE_* are backend `errorCode`s; the rest are HTTP-status
// fallbacks. VALIDATION_FAILED / WALLET_NOT_FOUND are intentionally absent — the handle is
// schema-validated in the action and those status fallbacks collapse to SERVER_ERROR (mirrors
// removeStatusFallback).
export type SetHandleErrorCode =
  | 'HANDLE_TAKEN' // 409
  | 'HANDLE_FORMAT_INVALID' // 422
  | 'HANDLE_RESERVED' // 422
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

// Read codes (GET /v1/me/handle) — only auth/transport can fail.
export type GetHandleErrorCode = 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'SERVER_ERROR';

// Discriminated so illegal combinations (available + reason, unavailable + no reason) can't exist.
export type CheckHandleResult =
  | { status: 'available' }
  | { status: 'unavailable'; reason: CheckHandleReason }
  | { status: 'error'; code: CheckHandleErrorCode };

// Success carries no payload: the commit action server-redirects on success, so the DTO never reaches
// the client. The 200 body is still validated in the service (a malformed body → SERVER_ERROR). If a
// future handle-display screen needs the value, re-add it and use the stored (cased) `handle` for
// display and the lowercase `handleCanonical` only as a lookup key.
export type SetHandleResult =
  | { status: 'success' }
  | { status: 'error'; code: SetHandleErrorCode; message: string };

// Read result — the page narrows: success+non-null → auto-skip; success+null → render; error+
// SESSION_EXPIRED → /login; error+transient → fail-open render. Carries no user-facing message.
export type GetHandleResult =
  | { status: 'success'; handle: string | null }
  | { status: 'error'; code: GetHandleErrorCode };

// Client state machine for useHandlePicker. `unavailable` carries the check reason + curated copy;
// `error` merges check-transport and submit failures (both render `message` identically, so no
// `phase` discriminant is carried). `code` is a typed union — an unmapped code fails to compile at the
// HANDLE_MESSAGES lookup. There is no `done` state — a successful commit server-redirects (terminal).
export type HandlePickerState =
  | { status: 'idle' } // empty / untouched
  | { status: 'invalid'; message: string } // fails local handleSchema — no network check
  | { status: 'debouncing' } // schema-valid, waiting out the debounce
  | { status: 'checking' } // GET /handles/check in flight
  | { status: 'available' } // CTA-enabled
  | { status: 'unavailable'; reason: CheckHandleReason; message: string }
  | { status: 'submitting' } // POST /me/handle in flight
  | { status: 'error'; code: CheckHandleErrorCode | SetHandleErrorCode; message: string };

export interface UseHandlePickerReturn {
  value: string;
  state: HandlePickerState;
  onChange: (raw: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (raw: string) => void;
  submit: () => Promise<void>;
}
