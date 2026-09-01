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
      // Null for passkey accounts that haven't set a name yet.
      firstName: string | null;
      lastName: string | null;
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

// The unified email-first passkey endpoint (TOV — /v1/auth/passkey/begin) tells the client which
// ceremony to run: 'login' → WebAuthn assertion (existing account), 'signup' → WebAuthn registration
// (new email). The backend decides from whether the email already has a passkey account.
export type PasskeyMode = 'login' | 'signup';

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

// begin: no tokens, options must reach the client — single result (no service/action split).
// Discriminated by `mode`: 'signup' carries creation options (startRegistration), 'login' carries
// request options (startAuthentication). The client branches the ceremony on `mode`.
export type PasskeyBeginResult =
  | { status: 'success'; mode: 'signup'; options: PublicKeyCredentialCreationOptionsJSON }
  | { status: 'success'; mode: 'login'; options: PublicKeyCredentialRequestOptionsJSON }
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

// `mode` on success lets the UI tailor copy (new account vs returning sign-in); it is only known
// once begin has resolved, so the transient states stay mode-agnostic.
export type PasskeyEnrollState =
  | { status: 'idle' }
  | { status: 'beginning' }
  | { status: 'signing' }
  | { status: 'finishing' }
  | { status: 'success'; mode: PasskeyMode; contractAddress: string }
  | { status: 'error'; code: PasskeyErrorCode; message: string };

// finish carries the mode plus the matching WebAuthn response — an attestation for a fresh signup,
// an assertion for a returning login. The backend accepts no deviceName.
export type FinishPasskeyInput =
  | { email: string; mode: 'signup'; attestationResponse: RegistrationResponseJSON }
  | { email: string; mode: 'login'; assertionResponse: AuthenticationResponseJSON };
export interface UsePasskeyEnrollReturn {
  state: PasskeyEnrollState;
  enroll: (email: string) => Promise<void>;
  // Recovers from an error. On a retryable finish failure it re-submits the same WebAuthn response
  // (bound to the original email); when the challenge is no longer valid it restarts from begin using
  // the `email` argument (the live form value, so a corrected typo is honoured).
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
  | { status: 'success'; wallet: AddedWallet }
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
  | { status: 'success'; wallet: AddedWallet }
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

// ── BYOW USDC trustline (TOV-47 / FR-01.11) ───────
// When a bound BYOW G-account lacks the platform USDC trustline, POST /me/wallets returns an optional
// `trustlineRequired` instruction (camelCase wire, TOV-32). The web app REBUILDS change_trust from
// `asset` + the wallet's live sequence (the seq=0 template is not directly submittable) and submits it
// to Horizon itself — no backend submit endpoint, no Server Action. See hooks/useWalletTrustline.ts,
// lib/stellar/*, and the plan docs/plans/2026-08-27-feat-byow-usdc-trustline-prompt-plan.md.

// One `{ code, issuer }` asset shape, shared by TrustlineRequired, PLATFORM_USDC, the client engine,
// and the derive so they can't drift.
export type StellarAsset = { code: string; issuer: string };

export type TrustlineRequired = {
  // Base64 seq=0 change_trust template from the backend. Parsed for SHAPE ONLY and otherwise UNUSED by
  // the client path: we rebuild change_trust from `asset` + the wallet's live sequence, and the asset is
  // re-pinned to the env-configured PLATFORM_USDC issuer before signing (that env pin is the trust
  // anchor — see hooks/useWalletTrustline.ts pinnedAsset). No cross-check against this template is done.
  changeTrustXdr: string;
  asset: StellarAsset;
};

// The add-201 body: a WalletSummary plus the optional instruction. Present ONLY on the add response,
// NEVER on GET /me/wallets — a distinct type so `trustlineRequired` can't leak into the list. Because
// the field is optional, a plain WalletSummary is still assignable to AddedWallet (widening). See
// walletManage.ts `addedWalletSchema` + `_AssertAddedShape`.
export type AddedWallet = WalletSummary & { trustlineRequired?: TrustlineRequired };

// Derived (server-side, from Horizon) settings-badge state for a BYOW wallet. 'unavailable' = no USDC
// issuer configured for the active network (mainnet pre-audit); 'unknown' = Horizon read failed
// (fail-open). Both render a neutral badge and never assert needed/ready.
export type TrustlineStatus = 'active' | 'missing' | 'unfunded' | 'unavailable' | 'unknown';

// Client trustline-flow error taxonomy. Gate/precheck codes are client-derived; submit codes come from
// Horizon result_codes. USER_CANCELLED / POPUP_BLOCKED are non-terminal (retry-sign). No SESSION_EXPIRED
// — the flow talks to Horizon + the wallet, not the Tove backend.
export type TrustlineErrorCode =
  | 'ISSUER_MISMATCH' // bind asset.issuer/code ≠ configured PLATFORM_USDC (security F1)
  | 'ISSUER_UNCONFIGURED' // no issuer configured for the active network (mainnet) — cannot sign
  | 'ACCOUNT_MISMATCH' // wallet's active account ≠ the bound address (C1)
  | 'NETWORK_MISMATCH' // wallet / app / issuer network disagree (C2)
  | 'WALLET_NOT_INSTALLED'
  | 'POPUP_BLOCKED'
  | 'USER_CANCELLED'
  | 'UNFUNDED' // account not found on-chain (Horizon 404)
  | 'REBUILD_EXHAUSTED' // tx_bad_seq / tx_too_late rebuild attempts exhausted
  | 'CONFIRMATION_PENDING' // submitted but unconfirmed within the poll budget (fail-open)
  | 'SUBMIT_FAILED' // wallet/Horizon submission failure (retryable)
  | 'HORIZON_UNAVAILABLE'; // Horizon read/submit unreachable
// NOTE: low reserve is surfaced via the `blockedLowReserve` state (with shortfall), not an error code.

// What the dialog offers on an error: retry-sign (re-prompt the wallet), recheck (re-run precheck,
// e.g. after funding), or terminal.
export type TrustlineRecovery = 'retry-sign' | 'recheck' | 'terminal';

// useWalletTrustline state machine. Blocked states carry the payload their copy needs (shortfall,
// message). Retry counters (rebuild attempts, poll budget) live in refs, not here. `polling` holds the
// submitted hash for the async-submit confirm loop; a rebuild folds back into `signing`; a skip closes
// to `idle` (no persisted state — the badge re-derives from Horizon).
export type WalletTrustlineState =
  | { status: 'idle' }
  | { status: 'gating' } // active-account + network + issuer checks in flight
  | {
      status: 'blockedGate';
      // Only the reachable gate codes (network mismatch surfaces via the `error` state, not the gate).
      code: 'ACCOUNT_MISMATCH' | 'ISSUER_MISMATCH' | 'ISSUER_UNCONFIGURED';
      message: string;
    }
  | { status: 'prechecking' } // Horizon loadAccount + reserve check in flight
  | { status: 'blockedUnfunded'; address: string }
  | { status: 'blockedLowReserve'; shortfallXlm: string }
  | { status: 'readyToSign'; asset: StellarAsset }
  | { status: 'signing' } // wallet signTransaction in flight
  | { status: 'submitting' } // Horizon submit in flight
  | { status: 'polling'; hash: string; attempt: number } // async-submit confirm loop
  | { status: 'success'; hash?: string } // hash present when a tx was submitted; absent for an already-trusts no-op
  | { status: 'error'; code: TrustlineErrorCode; message: string; recovery: TrustlineRecovery };

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

// ── Wallet Rotation (TOV-48 / FR-01.12) ───────────
// Holdings-transfer leg of wallet rotation (W1 embedded → W2 BYOW). Clones the export
// client-in-the-loop pattern against the rotate-transfer endpoints, with three deliberate divergences:
// per-item WebAuthn credentials (not top-level), itemId-correlated status (N fractions can share a
// tokenContract), and a batched submit. Only FractionTokens move — Soroban tokens, so NO trustline on
// the destination (TOV-33). No client idempotency key (server nonce + one-way latch + reconcile-via-
// status); confirmed items are never re-signed. See docs/plans/2026-08-27-feat-wallet-rotation-flow-plan.md.

// Two distinct top-level enums in the contract: `status` on initiate/submit (the rotation lifecycle)
// and `state` on the status endpoint (the reconciliation view). Kept separate so a schema can't blur them.
export type RotationLifecycle = 'pending' | 'submitting' | 'completed';
export type RotationState = 'none' | 'pending' | 'submitting' | 'confirmed' | 'failed';
export type RotationItemStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

// One fraction to transfer, from rotate-transfer initiate. Credentials are PER ITEM (unlike export's
// top-level ExportBeginData) — the signing loop builds an assertion per item. amountScaled is a scaled-
// i128 decimal STRING (never a number); FractionToken decimals = 0 (whole fraction counts).
// expiresAtLedger is a Stellar ledger sequence number, not a timestamp.
export interface RotationItem {
  itemId: string;
  tokenContract: string;
  amountScaled: string;
  decimals: number;
  // Best-effort on-chain symbol for display (artwork titles need the M04 registry); optional.
  displayName?: string;
  challenge: string;
  expiresAtLedger: number;
  credentialId: string;
  rpId: string;
  transports: string | null;
}

// initiate 200 body. `items[]` is never empty on 200 — an empty W1 returns 422 ROTATION_NOTHING_TO_TRANSFER.
export interface RotationBeginData {
  rotationId: string;
  status: RotationLifecycle;
  destinationWalletId: string;
  items: RotationItem[];
}

// The signed material the client returns per item (extracted from the assertion's `response`). Built
// with EXACTLY these fields — never spread the raw PublicKeyCredential (a stray id/rawId/type/
// clientExtensionResults would 400 the whole batch under the backend's forbidNonWhitelisted).
export interface SignedRotationItem {
  itemId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

// One item from submit/status — correlated by REQUIRED itemId. errorCode is enumerated-only (no
// free-text), classified via TransferItemCode after parse (unknown → terminal). txHash/ledger are
// best-effort (a recovered `confirmed` may carry null — never require them).
export interface RotationItemStatusDetail {
  itemId: string;
  tokenContract: string;
  amountScaled: string;
  status: RotationItemStatus;
  txHash?: string | null;
  ledger?: number | null;
  errorCode?: string;
  // Correlated client-side from the begin items by itemId for the progress/partial screens.
  displayName?: string;
  decimals?: number;
}

// submit 200 body. `status` is the accepted lifecycle; per-item detail is authoritative on the STATUS
// endpoint (submit items are consumed only for optimistic progress — treat `submitted` as non-terminal).
export interface RotationSubmitData {
  rotationId: string;
  status: RotationLifecycle;
  items: RotationItemStatusDetail[];
}

// GET .../rotate-transfer/status — reconciliation (re-reads on-chain). `state: 'none'` = no rotation for
// this source. destinationWalletId/destinationAddress are echoed (TOV-33 Q7) → server-authoritative for
// resume display + selector-lock.
export interface RotationStatusData {
  rotationId: string;
  state: RotationState;
  destinationWalletId: string;
  destinationAddress: string;
  items: RotationItemStatusDetail[];
}

// Error taxonomy. Backend-origin codes map from `errorCode`; SESSION_EXPIRED/NETWORK_ERROR/SERVER_ERROR/
// RATE_LIMITED are HTTP-status fallbacks; PASSKEY_FAILED is client-only. Per-item TRANSFER_* settlement
// outcomes live in TransferItemCode, NOT here (so the two classifiers can't disagree on retryability).
export type WalletRotationErrorCode =
  | 'VALIDATION_FAILED'
  | 'WALLET_NOT_FOUND'
  | 'ROTATION_SOURCE_INVALID'
  | 'ALREADY_EXPORTED'
  | 'ROTATION_DESTINATION_INVALID'
  | 'ROTATION_DESTINATION_NOT_PRIMARY'
  | 'ROTATION_CONFLICT' // export OR rotation already active on the source — read status to disambiguate
  | 'ROTATION_NOTHING_TO_TRANSFER'
  | 'ROTATION_BLOCKED_BY_LOCKUP'
  | 'RECIPIENT_NOT_WHITELISTED'
  | 'ROTATION_NOT_FOUND'
  | 'ROTATION_CANNOT_CANCEL'
  | 'PASSKEY_FAILED' // client-side signing ceremony failure (not a backend code)
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR';

// Per-item settlement outcomes (enumerated + classified by backend — TOV-33 Q2). Retryable ones rebuild
// via the standard loop (poll status → initiate rebuilds non-zero-balance items → re-sign); for
// TRANSFER_SIMULATION_FAILED / TRANSFER_FAILED, poll status FIRST (a landed tx auto-reconciles to
// confirmed). Terminal ones surface + stop. Unknown → terminal.
export type TransferItemCode =
  | 'TRANSFER_EXPIRED'
  | 'TRANSFER_UNAVAILABLE'
  | 'TRANSFER_SIMULATION_FAILED'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_SIGNATURE_INVALID'
  | 'TRANSFER_SIGNATURE_REQUIRED'
  | 'RECIPIENT_NOT_WHITELISTED';

// initiate carries `lockupExpiresAt` (ISO-8601 UTC) on the ROTATION_BLOCKED_BY_LOCKUP error only, so the
// review step can name the unlock date (TOV-33 Q1). Never surface the raw backend message for that code.
export type RotationInitiateResult =
  | { status: 'success'; data: RotationBeginData }
  | { status: 'error'; code: WalletRotationErrorCode; message: string; lockupExpiresAt?: string };

export type RotationSubmitResult =
  | { status: 'success'; data: RotationSubmitData }
  | { status: 'error'; code: WalletRotationErrorCode; message: string };

export type RotationStatusResult =
  | { status: 'success'; data: RotationStatusData }
  | { status: 'error'; code: WalletRotationErrorCode; message: string };

export type RotationCancelResult =
  | { status: 'success'; canceledId: string }
  | { status: 'error'; code: WalletRotationErrorCode; message: string };

// Client state machine for the rotation wizard (useWalletRotation). The five in-loop phases collapse into
// one `transferring` state carrying a shared RotationProgress payload (the wizard renders the same
// "Transferred X of N" surface for all). `error` deliberately carries NO counts — by construction it
// means nothing moved (anything that moved routes to `partial`/`settlementUnknown`).
export type RotationDestination = Pick<WalletSummary, 'id' | 'address'>;
export type RotationProgress = {
  confirmedCount: number;
  total: number; // the ORIGINAL N from status — stable across rebuilds; confirmedCount is monotonic
  destination: RotationDestination;
};

// Review-step block. `lockupExpiresAt` (ISO-8601 UTC, TOV-33 Q1) is OPTIONAL and defensive: the "name the
// lockup expiry" AC is enforced at RUNTIME by lockupBlockedMessage(), which composes the specific line when
// the date is present and falls back to generic copy otherwise (NOT a compile-time guarantee).
export type RotationBlocked =
  | { code: 'ROTATION_BLOCKED_BY_LOCKUP'; lockupExpiresAt?: string }
  | { code: 'RECIPIENT_NOT_WHITELISTED'; message: string };

export type WalletRotationState =
  | { status: 'loading' } // SSR handoff / initial status read
  | { status: 'selectingDestination'; wallets: WalletSummary[]; inlineError?: string }
  | {
      status: 'reviewing';
      destination: RotationDestination;
      items: RotationItem[];
      blocked?: RotationBlocked;
    }
  | ({
      status: 'transferring';
      phase: 'signing' | 'submitting' | 'polling' | 'rebuilding';
    } & RotationProgress)
  | ({ status: 'paused' } & RotationProgress) // passkey cancelled mid-loop, ≥1 confirmed
  | ({ status: 'partial'; items: RotationItemStatusDetail[] } & RotationProgress)
  | ({ status: 'settlementUnknown' } & RotationProgress) // lost response / session-expiry / wall-clock
  | { status: 'complete'; destination: RotationDestination; movedCount: number }
  | { status: 'error'; code: WalletRotationErrorCode; message: string };

export interface UseWalletRotationReturn {
  state: WalletRotationState;
  chooseDestination: (destination: RotationDestination) => Promise<void>; // → set-primary (auto) → review
  confirmAndTransfer: () => Promise<void>; // reviewing → batched sign/submit/poll → terminal
  resume: () => Promise<void>; // rehydrate an in-flight rotation from status
  cancel: () => Promise<void>; // cancel a pre-submit rotation (backend enforces the window)
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

// ── Collector public profile (TOV-44 / FR-01.06) ──
// Public read of GET /v1/collectors/:handle (backend TOV-27). previousHandles is already normalized by
// the backend (newest-first, deduped by canonical, current handle excluded, capped at 50, and `[]` when
// the collector hid their history) — the web layer trusts it and never re-normalizes.
export interface CollectorProfile {
  handle: string; // stored (display) casing; the backend resolves the canonical lookup
  previousHandles: readonly string[]; // newest-first, already normalized — never mutated (todo 113)
}

// Discriminated so the page can route each outcome distinctly.
export type CollectorProfileResult =
  | { status: 'success'; profile: CollectorProfile }
  | { status: 'not_found' } // → notFound(); no payload (app/not-found.tsx is static)
  | { status: 'error' }; // → page throws to app/error.tsx; deliberately payload-free (never rendered)

// ── KYC submission (TOV-34 / FR-01.07) ────────────
// A guided wizard: pick jurisdiction → upload 4 documents → review → submit multipart to
// POST /v1/me/kyc/submissions (backend TOV-28, verified against PR #30). Direction B: in-progress files
// live in hook state, only non-PII progress metadata is persisted (localStorage), and the idempotency
// key lives in a hook ref (minted on first submit of a payload, invalidated on any payload mutation,
// reused only for a byte-identical retry). Codes are mapped from the response `errorCode`; SESSION_EXPIRED
// / NETWORK_ERROR / SERVER_ERROR are HTTP-status fallbacks. No raw backend message is ever surfaced —
// only curated copy from kycMessages.ts (a KYC pipeline shouldn't leak internal diagnostics).

// Collector KYC lifecycle on `users.kyc_status`. Resubmission is allowed only from not_submitted/rejected.
export type KycStatus = 'not_submitted' | 'pending_review' | 'approved' | 'rejected';

// The four identity documents, in wire order. snake_case field names (backend FileFieldsInterceptor).
export type KycDocType = 'gov_id_front' | 'gov_id_back' | 'proof_of_address' | 'selfie';

// Backend-origin codes (from the response `errorCode`) — all pass through verbatim to curated copy.
export type KycBackendErrorCode =
  | 'JURISDICTION_NOT_ELIGIBLE' // 422 — jurisdiction not on the allowlist
  | 'KYC_ALREADY_PENDING' // 409 — a submission is already under review
  | 'KYC_ALREADY_APPROVED' // 409 — already approved, no resubmit
  | 'KYC_MISSING_DOCUMENT' // 422 — one of the 4 fields absent
  | 'KYC_UNEXPECTED_DOCUMENT' // 422 — unknown/extra/duplicate field
  | 'KYC_UNSUPPORTED_MEDIA_TYPE' // 422 — not JPEG/PNG/PDF or declared≠sniffed
  | 'KYC_FILE_TOO_LARGE' // 422 — a document exceeds the 10 MB cap
  | 'KYC_FILE_EMPTY' // 422 — a document is 0 bytes
  | 'IDEMPOTENCY_KEY_IN_FLIGHT' // 409 — same key still processing → retry-send
  | 'IDEMPOTENCY_KEY_MISMATCH' // 422 — same key, different body → mint fresh
  | 'RATE_LIMITED' // 429 — submit throttled 5/hour
  | 'VALIDATION_FAILED'; // 400 — malformed jurisdiction / missing key

// HTTP-status fallbacks (never sent by the backend as an `errorCode` for this flow).
export type KycTransportErrorCode = 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'SERVER_ERROR';

export type KycSubmitErrorCode = KycBackendErrorCode | KycTransportErrorCode;

// GET /v1/me/kyc → status + latest-submission metadata (never document bytes/keys/URLs). The page gate
// branches only on `kycStatus`; `latestSubmission` is parsed but currently UNUSED. NOTE: FR-01.08 (the
// whitelist status card) does NOT consume this — it reads its own endpoint (GET /v1/me/kyc/status →
// `lastSubmissionAt`). Retained as forward-compat metadata for a future submission-history surface; drop if
// none materializes (see todo #125).
export interface KycLatestSubmission {
  submissionId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  claimedJurisdiction: string;
  createdAt: string;
}

export type KycStatusResult =
  | { status: 'success'; kycStatus: KycStatus; latestSubmission: KycLatestSubmission | null }
  | { status: 'error'; code: KycTransportErrorCode; message: string };

// 202 body: { submissionId, status: 'pending_review', kycStatus }.
export type KycSubmitResult =
  | { status: 'success'; submissionId: string; kycStatus: KycStatus }
  | { status: 'error'; code: KycSubmitErrorCode; message: string };

// Client state machine for the wizard (useKycSubmission). Wizard step + async phase collapsed into one
// union (mirrors WalletExportState) so illegal step/phase combos can't exist. Bare `status` is the
// discriminant; the KYC lifecycle value is always carried as `reason` (never a second `status`). `error`
// carries `retryable` so the UI knows whether to offer retry (RATE_LIMITED/terminal codes are not).
export type KycWizardState =
  | { status: 'jurisdiction'; inlineError?: string }
  | { status: 'documents'; slotError?: { docType: KycDocType; message: string } }
  | { status: 'review' }
  | { status: 'submitting' }
  | { status: 'confirmation'; submissionId: string }
  | { status: 'blocked'; reason: 'pending' | 'approved' }
  | { status: 'sessionExpired' }
  | { status: 'error'; code: KycSubmitErrorCode; message: string; retryable: boolean };

// GET /v1/me/kyc/status (backend TOV-29 / FR-01.08). The on-chain WHITELIST lifecycle — distinct from the
// KYC submission lifecycle (KycStatus) above, though they overlap. Rendered by the whitelist status card on
// /settings/kyc, which coexists with (does not replace) the submission gate.
//
// Wire contract (confirmed with TOV-29, locked): camelCase, and all four keys are ALWAYS present — null
// when not applicable (whitelistedAt/reason/lastSubmissionAt are `T | null`, never absent). Timestamps are
// ISO-8601 UTC (…Z). We narrow to a discriminated union internally so the card reads only the field that
// matters per state.
//
// NOTE: frozen/removed carry `reasonCopy` — the curated display string RESOLVED SERVER-SIDE from the opaque
// backend reason code (see whitelistReasonCopy). The raw code never crosses the server→client boundary, so a
// future M12 reason value (potentially sensitive/diagnostic) can't leak into the client payload.
export type WhitelistStatus =
  | 'not_submitted'
  | 'pending_review'
  | 'whitelisted'
  | 'frozen'
  | 'removed';

export type WhitelistStatusData =
  | { status: 'not_submitted' }
  | { status: 'pending_review'; lastSubmissionAt: string | null }
  | { status: 'whitelisted'; whitelistedAt: string | null }
  | { status: 'frozen'; reasonCopy: string }
  | { status: 'removed'; reasonCopy: string };

// Read result. Reuses KycTransportErrorCode — a status read carries no backend errorCodes, only the three
// transport fallbacks (SESSION_EXPIRED/NETWORK_ERROR/SERVER_ERROR), same as getKycStatus.
export type WhitelistStatusResult =
  | { status: 'success'; data: WhitelistStatusData }
  | { status: 'error'; code: KycTransportErrorCode; message: string };

// GET /v1/me/holdings (backend TOV-237 / FR-04.MVP.04). Collector fraction holdings, one row per artwork.
// Contract verified against the merged `HoldingDto` (tove-be#35): camelCase keys; amounts are i128-safe
// DECIMAL STRINGS (not numbers), so they survive values beyond 2^53; `artworkImageUrl`/`artistHandle` are
// nullable (key always present); `artworkSlug` is derived and always present. The domain object drops
// `artworkId` (routing uses the slug, Sell uses `tokenContract`) to minimize the client egress surface;
// `tokenContract` is the SHARED FractionToken asset contract (not a wallet), egressed for the Sell deep-link.
export type Holding = {
  artworkTitle: string;
  artworkSlug: string;
  artworkImageUrl: string | null; // null/empty → placeholder tile (never passed to next/image)
  artistHandle: string | null; // null/empty → title-only row
  tokenContract: string;
  balance: string; // i128-safe decimal string, e.g. "60"
  lockedBalance: string;
  freeBalance: string; // gates the Sell CTA (advisory / display-only; settlement re-reads on-chain)
};

// Transport-only union (a read carries no backend errorCodes) — mirrors KycTransportErrorCode. A 503
// HOLDINGS_UNAVAILABLE / 500 / 429 all fold into SERVER_ERROR.
export type HoldingsTransportErrorCode = 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'SERVER_ERROR';

export type HoldingsResult =
  // `droppedCount` = rows that failed per-row validation and were skipped (see getHoldings). It drives a
  // "some holdings couldn't be shown" notice so a partial list never silently looks complete.
  | { status: 'success'; holdings: Holding[]; droppedCount: number } // empty = holdings.length === 0
  | { status: 'error'; code: HoldingsTransportErrorCode; message: string };

// ── Offering subscription + bid (TOV-157 / FR-05.03) ──────────────────────────────────────────────
// Public offering page + whitelisted passkey-signed USDC bid. Backend contract: TOV-156 (temp, DRAFT).
// See docs/plans/2026-08-20-feat-offering-subscription-ui-plan.md. Amounts are i128-safe DECIMAL STRINGS
// (never numbers): band, price, escrowAmountStroops, publicFloat. BigInt is transient (lib/offerings/format);
// a bigint domain field would throw on JSON.stringify across the RSC/Server-Action boundary. No raw backend
// message ever reaches the UI — only curated OFFERINGS_MESSAGES copy.

// The offering lifecycle enum, verbatim (GET /v1/offerings/:id). There is NO "closed" — only `opened`
// (+ in-window) is biddable. Const-tuple source of truth lives in lib/services/offerings.ts.
export type OfferingStatus =
  | 'planned'
  | 'approved'
  | 'opened'
  | 'subscribed'
  | 'settled'
  | 'canceled';

// The bid lifecycle. `submitted` = recorded, escrow queued (poll); `escrowed` = USDC locked (terminal ✓);
// `failed` = async worker failure, NO reason field (terminal, generic copy). `canceled` is a future FR.
export type BidStatus = 'submitted' | 'escrowed' | 'failed';

// Public offering read (TOV-163 assumed shape). escrowContractAddress is null until escrow is deployed
// (status ≥ approved). Amounts are decimal strings.
export interface Offering {
  id: string;
  artworkId: string;
  status: OfferingStatus;
  lowPriceStroops: string;
  highPriceStroops: string;
  publicFloat: string;
  windowOpenAt: string; // ISO-8601 UTC
  windowCloseAt: string; // ISO-8601 UTC
  escrowContractAddress: string | null; // present-but-null (nullable, not optional — a dropped key is drift)
  artworkTitle: string;
  artworkImageUrl: string | null; // null/empty → placeholder tile (never passed to next/image)
  artistHandle: string | null;
}

// The caller's active bid (GET /offerings/:id/bids/me). One active bid per collector. chainBidId/
// escrowTxHash are present-but-null until escrowed.
export interface Bid {
  id: string;
  offeringId: string;
  price: string; // per-fraction USDC stroops
  count: number;
  escrowAmountStroops: string; // price × count
  status: BidStatus;
  chainBidId: number | null;
  escrowTxHash: string | null;
  createdAt: string;
}

// The prepare envelope — the one place ceremony material legitimately crosses to the client (mirrors
// ExportBeginData / PasskeyBeginResult). Confined to PrepareBidResult so it can't structurally leak onto
// MyBidResult/SubmitBidResult. txXdr is echoed back verbatim at submit. expiresAtLedger is a Stellar ledger
// sequence number, not a timestamp.
export interface PrepareBidData {
  txXdr: string;
  challenge: string;
  credentialId: string;
  transports: string | null;
  rpId: string;
  escrowAmountStroops: string; // authoritative "you pay" (snap the display to this post-prepare)
  expiresAtLedger: number;
}

// Backend `errorCode`s for the bid endpoints (prepare/submit). A newly added code must be classified in the
// IS_BID_BACKEND_CODE passthrough Record (lib/services/offerings.ts) or it fails to compile. WALLET_NOT_FOUND
// and OFFERING_NOT_FOUND are BOTH 404 — the service branches on errorCode, never on HTTP status.
export type BidBackendErrorCode =
  | 'BID_INSUFFICIENT_BALANCE'
  | 'BID_BELOW_LOW_PRICE'
  | 'BID_ABOVE_HIGH_PRICE'
  | 'BID_COUNT_EXCEEDS_FLOAT'
  | 'OFFERING_WINDOW_NOT_OPEN'
  | 'OFFERING_WINDOW_CLOSED'
  | 'OFFERING_NOT_OPEN'
  | 'BID_ALREADY_ACTIVE'
  | 'IDEMPOTENCY_KEY_IN_FLIGHT'
  | 'IDEMPOTENCY_KEY_MISMATCH'
  | 'BID_CHALLENGE_EXPIRED'
  | 'BID_NOT_WHITELISTED'
  | 'WALLET_NOT_FOUND'
  | 'OFFERING_NOT_FOUND';

// HTTP-status fallbacks for the AUTHED bid endpoints (prepare/submit/getMyBid).
export type BidTransportErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

export type BidErrorCode = BidBackendErrorCode | BidTransportErrorCode;

// The PUBLIC offering read is tokenless — it can't produce SESSION_EXPIRED. A codeless 404 defaults to
// OFFERING_NOT_FOUND (its only 404 meaning); everything else folds to SERVER_ERROR / NETWORK_ERROR / RATE_LIMITED.
export type OfferingReadErrorCode =
  | 'OFFERING_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

// The full UI-facing code superset (drives the exhaustive OFFERINGS_MESSAGES Record). Includes synthetic
// client states with no backend code: BID_FAILED (poll status:failed, G5b), PASSKEY_CANCELLED (opaque
// NotAllowedError, G8), PASSKEY_UNSUPPORTED (detectPasskeySupport false, G8).
export type OfferingUiCode =
  | BidErrorCode
  | OfferingReadErrorCode
  | 'BID_FAILED'
  | 'PASSKEY_CANCELLED'
  | 'PASSKEY_FAILED'
  | 'PASSKEY_UNSUPPORTED';

// Result unions — structurally SEPARATE (no shared base) so PrepareBidData can't leak onto the others.
export type OfferingResult =
  | { status: 'success'; offering: Offering }
  | { status: 'error'; code: OfferingReadErrorCode; message: string };

export type PrepareBidResult =
  | { status: 'success'; data: PrepareBidData }
  | { status: 'error'; code: BidErrorCode; message: string; required?: string; available?: string };

export type SubmitBidResult =
  | { status: 'success'; bid: Bid }
  | { status: 'error'; code: BidErrorCode; message: string };

// getMyBid: a 200/204 empty body (no active bid) → { status:'success', bid: null }. A 404 stays in the ERROR
// path (branched on errorCode) — a 404 WALLET_NOT_FOUND must surface the enrol signal, not masquerade as null.
export type MyBidResult =
  | { status: 'success'; bid: Bid | null }
  | { status: 'error'; code: BidErrorCode; message: string };

// The bid the client submits (extracted from the WebAuthn assertion + the verbatim prepared tx).
export interface BidInput {
  price: string; // per-fraction USDC stroops
  count: number;
}
export interface SubmitBidInput {
  txXdr: string; // verbatim from prepare
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

// Server-Action signatures — FROZEN in Foundation (WS-A) so the client hooks (WS-E) compile against these
// types with mocked actions while WS-C implements them in parallel. The Idempotency-Key is a plain positional
// argument (never a FormData field) — matches app/actions/walletManage.ts.
export type PrepareBidAction = (
  offeringId: string,
  input: BidInput,
  idempotencyKey: string,
) => Promise<PrepareBidResult>;
export type SubmitBidAction = (
  offeringId: string,
  input: SubmitBidInput,
  idempotencyKey: string,
) => Promise<SubmitBidResult>;
export type RefreshMyBidAction = (offeringId: string) => Promise<MyBidResult>;

// The UI state the OfferingPage switches over for a viewer's bid capability (computed SSR from status +
// whitelist + token). Keeps the gate decision in one typed place.
export type OfferingUiState = 'coming-soon' | 'biddable' | 'closed' | 'canceled';
export type BidGateReason =
  | 'anon'
  | 'not-whitelisted'
  | 'no-passkey'
  | 'unsupported'
  | 'session-expired';

// ── RFQ create (TOV-173 / FR-06.01) ────────────────────────────────────────────────────────────────
// A whitelisted Collector's secondary-market buy intent on a fractionalized artwork (POST
// /api/v1/marketplace/rfqs). Pure create — no funds move, no signing, no on-chain tx. Backend contract
// TOV-172 (temp, DRAFT). Amounts are i128/2^96-safe DECIMAL STRINGS as a repo convention (snake_case-string
// wire parity, the `0n`-literal build gate, test determinism) — never numbers. No raw backend message ever
// reaches the UI — only curated RFQ_MESSAGES copy.

// RFQ lifecycle. 'open' on create; open → filled | canceled | expired. Post-expiry the stored status may
// still read 'open' (no sweeper) — the UI derives "expired" client-side from expires_at.
export type RfqStatus = 'open' | 'filled' | 'canceled' | 'expired';

// Advisory soft warning on a 201: present only when on-chain USDC looks insufficient. Tri-state — ABSENCE
// never proves solvency (funds-ok and not-computable are indistinguishable). Never gates submission.
export interface BalanceWarning {
  requiredStroops: string;
  availableStroops: string;
}

// The client's create-RFQ input. artworkId is a POSITIONAL action/service argument (mirrors BidInput's
// offeringId), NOT a field here. maxPricePerFractionStroops is an INTEGER stroop string (the form converts the
// USDC input via usdcToStroops first). expiryHours is constrained to the dropdown presets.
export interface RfqInput {
  fractionCount: number; // integer >= 1
  maxPricePerFractionStroops: string; // "1".."79228162514264337593543950335" (2^96-1)
  expiryHours: 24 | 48 | 72 | 168;
}

// The mapped 201 body — ONLY the fields the confirmation renders (egress minimization). collector_sub,
// fraction_contract_id, and created_at are intentionally NOT mapped: internal ids never reach the browser.
export interface Rfq {
  id: string;
  fractionCount: string; // string for i128-safety
  maxPricePerFractionStroops: string;
  status: RfqStatus; // 'open' on create
  expiresAt: string; // ISO-8601 UTC
  balanceWarning?: BalanceWarning; // present-only-when-fresh (a replayed 201 may omit it)
}

// Backend `errorCode`s for POST /marketplace/rfqs. A newly added code must be classified in the
// IS_RFQ_BACKEND_CODE passthrough Record (lib/services/rfqs.ts) or it fails to compile.
export type RfqBackendErrorCode =
  | 'VALIDATION_FAILED'
  | 'RFQ_NOT_WHITELISTED'
  | 'ARTWORK_NOT_FOUND'
  | 'RFQ_ARTWORK_NOT_FRACTIONALIZED'
  | 'RFQ_INVALID_PRICE'
  | 'RFQ_AMOUNT_OVERFLOW'
  | 'RFQ_TOO_MANY_ACTIVE'
  | 'IDEMPOTENCY_KEY_IN_FLIGHT'
  | 'IDEMPOTENCY_KEY_MISMATCH';

// HTTP-status fallbacks. Dedicated to RFQ — NOT the shared statusFallbackCode (its 404 → WALLET_NOT_FOUND is
// nonsensical here). No 404/409 case (both overloaded; meaning comes only from the backend errorCode).
export type RfqTransportErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

export type RfqErrorCode = RfqBackendErrorCode | RfqTransportErrorCode;

// The create result. On success the RFQ (with optional advisory warning); on error a curated code + message.
export type CreateRfqResult =
  | { status: 'success'; rfq: Rfq }
  | { status: 'error'; code: RfqErrorCode; message: string };

// Frozen server-action signature — the client hook (useCreateRfq) compiles against this with a mocked action
// while the action/service are implemented in parallel. The Idempotency-Key is a plain positional argument.
export type CreateRfqAction = (
  artworkId: string,
  input: RfqInput,
  idempotencyKey: string,
) => Promise<CreateRfqResult>;

// The RFQ gate ladder's reasons — independent of the offering subscription window (RFQ is marketplace-scoped).
export type RfqGateReason = 'anon' | 'not-whitelisted';

// ── Quote submission (TOV-176 / FR-06.03) ──────────────────────────────────────────────────────────
// A whitelisted HOLDER's sell offer into an open RFQ (POST /api/v1/marketplace/rfqs/{rfqId}/quotes). Pure DB
// write — no funds move, no signing, no on-chain tx at submit (settlement is FR-06.04). Backend contract
// TOV-175 (DRAFT; endpoint UNBUILT as of 2026-08-22). Wire is camelCase (the strict api/v1 house convention —
// see the offering bid service). Amounts are i128/2^96-safe DECIMAL STRINGS as a repo convention, never
// numbers. No raw backend message ever reaches the UI — only curated QUOTE_MESSAGES copy.

// Quote lifecycle. Only 'open' is returned on create; the rest of the lifecycle is FR-06.04. Kept intentionally
// narrow (fail-closed): any non-'open' wire status fails the z.enum → SERVER_ERROR. Widen when accept-and-settle
// ships. The confirmation derives "expired" from validUntil, never from status.
export type QuoteStatus = 'open';

// The client's submit input. rfqId is a POSITIONAL action/service argument (mirrors RfqInput's artworkId), NOT
// a field here. pricePerFractionStroops is an INTEGER stroop string (the form converts the USDC input via
// usdcToStroops first). validUntil is an ISO-8601 instant WITH an explicit tz offset, resolved from the preset
// AT submit (a `…Z` instant) and frozen into the request body.
export interface QuoteInput {
  fractionCount: number; // integer >= 1
  pricePerFractionStroops: string; // "1".."79228162514264337593543950335" (2^96-1)
  validUntil: string; // ISO-8601 with explicit tz offset, > now
}

// The mapped 201 body — ONLY the fields the confirmation renders (egress minimization). holderSub,
// fractionContractId, and createdAt are intentionally NOT mapped: internal ids never reach the browser.
export interface Quote {
  id: string;
  rfqId: string;
  fractionCount: string; // string for i128-safety (numeric(39,0))
  pricePerFractionStroops: string;
  validUntil: string; // ISO-8601; possibly CAPPED to the RFQ's expiry
  validUntilCapped?: true; // present-only-when-true; `false` is unrepresentable (mirrors the wire literal)
  status: QuoteStatus; // 'open' on create
}

// Extra fields on the 422 QUOTE_INSUFFICIENT_FREE_BALANCE body — fraction COUNTS as numeric(39,0) strings
// (not stroops). Parsed defensively as decimal strings; absent/malformed → undefined (never fabricated).
export interface InsufficientBalanceDetail {
  requiredFractionCount: string;
  freeFractionCount: string;
}

// Backend `errorCode`s for POST …/quotes. A new code must be classified in the IS_QUOTE_BACKEND_CODE
// passthrough Record (lib/services/quotes.ts) or it fails to compile. QUOTE_BALANCE_UNAVAILABLE (503) is a
// backend code AND the 503 status fallback (see quoteStatusFallback). DRAFT — provisional until TOV-175 merges.
export type QuoteBackendErrorCode =
  | 'VALIDATION_FAILED'
  | 'QUOTE_NOT_WHITELISTED'
  | 'QUOTE_RFQ_NOT_FOUND'
  | 'QUOTE_ALREADY_OPEN'
  | 'IDEMPOTENCY_KEY_IN_FLIGHT'
  | 'QUOTE_RFQ_NOT_OPEN'
  | 'QUOTE_RFQ_EXPIRED'
  | 'QUOTE_ON_OWN_RFQ'
  | 'QUOTE_INVALID_PRICE'
  | 'QUOTE_AMOUNT_OVERFLOW'
  | 'QUOTE_INVALID_VALIDITY'
  | 'QUOTE_NO_SETTLEMENT_WALLET'
  | 'QUOTE_INSUFFICIENT_FREE_BALANCE'
  | 'IDEMPOTENCY_KEY_MISMATCH'
  | 'QUOTE_BALANCE_UNAVAILABLE';

// HTTP-status fallbacks. Dedicated to quotes — NOT the shared statusFallbackCode (its 404 → WALLET_NOT_FOUND is
// nonsensical here). No 404/409 case (both overloaded; meaning comes only from the backend errorCode).
export type QuoteTransportErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

export type QuoteErrorCode = QuoteBackendErrorCode | QuoteTransportErrorCode;

// The error arm, with balanceDetail correlated to its ONLY code — it's a type error to attach it elsewhere, and
// `code === 'QUOTE_INSUFFICIENT_FREE_BALANCE'` narrows balanceDetail into scope for the panel.
export type QuoteError =
  | {
      code: 'QUOTE_INSUFFICIENT_FREE_BALANCE';
      message: string;
      balanceDetail?: InsufficientBalanceDetail;
    }
  | { code: Exclude<QuoteErrorCode, 'QUOTE_INSUFFICIENT_FREE_BALANCE'>; message: string };

// The submit result. On success the mapped quote; on error a curated code + message (+ balanceDetail on the one
// code that carries it).
export type SubmitQuoteResult =
  | { status: 'success'; quote: Quote }
  | ({ status: 'error' } & QuoteError);

// Frozen server-action signature — the client hook (useSubmitQuote) compiles against this with a mocked action
// while the action/service are implemented in parallel. The Idempotency-Key is a plain positional argument.
export type SubmitQuoteAction = (
  rfqId: string,
  input: QuoteInput,
  idempotencyKey: string,
) => Promise<SubmitQuoteResult>;

// The quote gate ladder's reasons — mirrors RfqGateReason (marketplace-scoped, offering-window-independent).
export type QuoteGateReason = 'anon' | 'not-whitelisted';

// ── Quote acceptance + atomic settlement (TOV-178 / FR-06.04) ────────────────────────────────────────
// The BUYER (RFQ creator) reviews the open quotes on their RFQ and accepts one via a two-gesture passkey
// ceremony (prepare → sign → submit) whose settlement is ASYNC (202 {tradeId, status:'pending'}), then polls
// GET …/accept/me until settled|failed. Mirrors the offering bid ceremony (TOV-157) beat-for-beat, with the
// marketplace camelCase wire (/api/v1/marketplace/...). Backend contract TOV-177.
//
// GROUND TRUTH: verified 2026-08-22 against the SHIPPED backend TOV-177 (../tove-be PR #49, merged). All accept
// endpoints (prepare/submit/me), error codes, and the failureReason set below are confirmed against the real
// DTOs. Money is i128-safe DECIMAL STRINGS (numeric(39,0)); buyer pays grossStroops with 0 buyer fees; seller
// nets 97% (1.5% treasury + 1.5% royalty). No raw backend message reaches the UI — only curated ACCEPT_MESSAGES.

// Trade lifecycle (secondary_trades.status; CONFIRMED enum + DB CHECK). `pending` = submitted, settling on-chain
// (poll); `settled` = confirmed (terminal, txHash present); `failed` = worker failure (terminal, failureReason).
export type TradeStatus = 'pending' | 'settled' | 'failed';

// Why a trade failed — the CLOSED set from the shipped settle-failure.constant.ts (12 literals). PERMISSIVE-IN /
// STRICT-OUT: an unrecognized value still coalesces to 'unknown' (defensive, in case the set grows). Bucket →
// quote outcome (per the shipped classifier): seller-fault → quote `expired` ("accept another");
// buyer/ambiguous → quote stays `open` ("re-accept"); invalid_trade/token_not_found → alert.
export type TradeFailureReason =
  | 'seller_balance_insufficient' // seller-fault → quote expired
  | 'seller_lockup'
  | 'seller_auth_lapsed'
  | 'buyer_signature_expired' // buyer/ambiguous → quote stays open
  | 'buyer_not_whitelisted'
  | 'buyer_usdc_insufficient' // buyer-fault (pre-settle balance path) — add funds + re-accept
  | 'party_frozen'
  | 'signature_invalid'
  | 'settlement_reverted'
  | 'settle_abandoned' // reconcile backstop abandoned a stranded pending trade past its retry horizon
  | 'invalid_trade' // → alert
  | 'token_not_found'
  | 'unknown'; // fallback — a set that grows server-side coalesces here rather than failing the parse.

// The caller's latest trade on an RFQ (GET …/accept/me projection, DRAFT). count/grossStroops are strings.
// txHash/settledAt present only when settled; failureReason only when failed. registryEventId is a forward-
// compat field for TOV-202 anonymize — CURRENTLY ALWAYS null (no backing column until TOV-181 ships).
export interface Trade {
  tradeId: string;
  status: TradeStatus;
  quoteId: string;
  count: string; // fraction count, numeric(39,0) string
  grossStroops: string; // buyer pays this (0 buyer fees)
  txHash: string | null; // present when settled
  settledAt: string | null; // ISO-8601; present when settled
  failureReason: TradeFailureReason | null; // present when failed
  registryEventId: string | null; // TOV-202 forward-compat; always null today
  createdAt: string;
}

// One open quote row on the RFQ-detail read (GET /api/v1/marketplace/rfqs/:id → quotes[]). CONFIRMED shipped
// DTO. `acceptable` = quote open AND seller holds a valid non-expired stored authorization (SQL-derived) — the
// per-row Accept-CTA gate; the FE never re-derives it. sellerHandle is the pseudonymous public handle (null for
// a wallet-only holder); raw auth entry / holder sub / wallet are never exposed. Rows arrive backend-sorted
// price ASC (FE re-sorts defensively). grossStroops = fractionCount × pricePerFractionStroops (SQL-computed).
// The quote lifecycle as it can appear on a marketplace row (the shipped detail DTO types `status` as a free
// string and returns only 'open' rows today, but widen to the real lifecycle so a future non-open row doesn't
// fail the whole RFQ-detail parse closed).
export type OpenQuoteStatus = 'open' | 'accepted' | 'canceled' | 'expired' | 'superseded';

export interface OpenQuote {
  quoteId: string;
  sellerHandle: string | null;
  fractionCount: string;
  pricePerFractionStroops: string;
  grossStroops: string;
  validUntil: string; // ISO-8601
  status: OpenQuoteStatus; // only 'open' rows are returned today; widened defensively
  acceptable: boolean; // REQUIRED — fails CLOSED on absence (a hard auth gate, not an advisory)
}

// The RFQ-detail envelope (GET /api/v1/marketplace/rfqs/:id). CONFIRMED shipped DTO. Owner-scoped: a non-creator
// caller gets 404 (no existence oracle). artworkSlug is nullable (slug fallback may be unavailable). status
// flips to 'filled' once a trade settles (rivals become 'superseded' and drop out of the open-quotes list).
export interface RfqDetail {
  id: string;
  artworkId: string;
  artworkSlug: string | null;
  fractionCount: string;
  maxPricePerFractionStroops: string;
  status: RfqStatus;
  expiresAt: string; // ISO-8601
  createdAt: string;
  quotes: OpenQuote[];
}

// The fee breakdown returned by accept/prepare (DRAFT field names). NAMED FeeBreakdown (not TradeQuote) to avoid
// colliding with the domain `Trade` via PrepareAcceptData.trade (plan D2). grossStroops is the SEC-5 authority.
export interface FeeBreakdown {
  grossStroops: string; // buyer pays (count × pricePerFractionStroops)
  sellerNetStroops: string; // 97%
  platformFeeStroops: string; // 1.5% (150 bps) — CONFIRMED in relayer
  artistRoyaltyStroops: string; // 1.5% (150 bps) — CONFIRMED in relayer
}

// The prepare envelope — the one place ceremony material legitimately crosses to the client (confined to
// PrepareAcceptResult so it can't leak onto the other result unions). CONFIRMED: `buyerAuthEntryXdr` is the
// buyer's OWN unsigned auth entry, NOT a full txXdr (the signed seller entry is never handed to the buyer —
// accept_quote is permissionless-caller). Echoed back verbatim at submit (SEC-6). expiresAtLedger is a Stellar
// LEDGER SEQUENCE NUMBER, not a timestamp — informational only, never a client countdown (plan AC-K).
export interface PrepareAcceptData {
  buyerAuthEntryXdr: string;
  challenge: string;
  credentialId: string;
  transports: string | null;
  rpId: string;
  expiresAtLedger: number;
  trade: FeeBreakdown;
}

// Backend `errorCode`s for the accept endpoints (prepare/submit/me). CONFIRMED against the shipped
// error-code.enum.ts (PR #49) — all 12 exist with the HTTP statuses noted. The classifier still degrades an
// unknown code to the HTTP-status fallback (never throws). A new code must be classified in the
// IS_ACCEPT_BACKEND_CODE passthrough Record (lib/services/accept.ts) or it fails to compile.
export type AcceptBackendErrorCode =
  | 'ACCEPT_NOT_RFQ_BUYER' // 403
  | 'ACCEPT_RFQ_NOT_OPEN' // 422
  | 'ACCEPT_QUOTE_NOT_ACCEPTABLE' // 422
  | 'ACCEPT_QUOTE_NOT_AUTHORIZED' // 422 (seller hasn't authorized yet)
  | 'ACCEPT_NOT_WHITELISTED' // 403
  | 'ACCEPT_INSUFFICIENT_USDC' // 422 (body adds requiredStroops/availableStroops)
  | 'ACCEPT_CHALLENGE_EXPIRED' // 422 (buyer signature stale)
  | 'TRADE_ALREADY_IN_FLIGHT' // 409 (a pending trade already exists on this RFQ)
  | 'TRADE_NOT_FOUND' // 404 (accept/me — no trade yet)
  | 'ACCEPT_SETTLEMENT_UNAVAILABLE' // 503 (retryable, same key)
  | 'IDEMPOTENCY_KEY_IN_FLIGHT' // 409
  | 'IDEMPOTENCY_KEY_MISMATCH'; // 422

// HTTP-status fallbacks for the AUTHED accept endpoints. Dedicated to accept — NOT the shared statusFallbackCode
// (its 404 → WALLET_NOT_FOUND is nonsensical here). No 404/409 case (both overloaded; meaning comes only from
// the backend errorCode — a codeless 404/409 fails safe to SERVER_ERROR).
export type AcceptTransportErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

export type AcceptErrorCode = AcceptBackendErrorCode | AcceptTransportErrorCode;

// The RFQ-detail read error codes. The shipped 404 backend code is QUOTE_RFQ_NOT_FOUND → mapped to RFQ_NOT_FOUND
// here (owner-scoped: a non-creator or missing RFQ both 404, no existence oracle). Owner-scoping is also
// enforced client-side via the isRfqCreator gate, so a 404 here is "gone or not yours".
export type RfqDetailErrorCode =
  | 'RFQ_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

// The full UI-facing code superset (drives the exhaustive ACCEPT_MESSAGES Record). Includes the read codes and
// the one synthetic client-only passkey state the accept flow actually emits: PASSKEY_FAILED (a hard assertion
// failure). A cancelled passkey routes back to `readyToSign` (not an error code), and passkey-unsupported is
// gated at the row level via the `passkeySupported` boolean — so neither warrants a UI code here (todo 186).
export type AcceptUiCode = AcceptErrorCode | RfqDetailErrorCode | 'PASSKEY_FAILED';

// Result unions — structurally SEPARATE (no shared base) so PrepareAcceptData can't leak onto the others.
export type RfqDetailResult =
  | { status: 'success'; rfq: RfqDetail }
  | { status: 'error'; code: RfqDetailErrorCode; message: string };

// accept/prepare: on error, requiredStroops/availableStroops ride ONLY on the ACCEPT_INSUFFICIENT_USDC arm
// (parsed as strings; absent/malformed → undefined, never fabricated).
export type PrepareAcceptResult =
  | { status: 'success'; data: PrepareAcceptData }
  | {
      status: 'error';
      code: AcceptErrorCode;
      message: string;
      requiredStroops?: string;
      availableStroops?: string;
    };

// accept: 202 → the async settlement handle. tradeStatus is always 'pending' on a fresh 202 (a replay returns
// the original 202). The buyer then hands off to the settlement poller.
export type SubmitAcceptResult =
  | { status: 'success'; tradeId: string; tradeStatus: 'pending' }
  | { status: 'error'; code: AcceptErrorCode; message: string };

// accept/me: a 200/204 empty body or a 404 TRADE_NOT_FOUND → { trade: null } (the NORMAL "no trade yet" state —
// it must NOT become a page/read error, or a first-time buyer lands on an error gate). Any other error stays in
// the error path.
export type MyTradeResult =
  | { status: 'success'; trade: Trade | null }
  | { status: 'error'; code: AcceptErrorCode; message: string };

// The client's accept input (prepare). quoteId is the chosen OpenQuote.
export interface AcceptInput {
  quoteId: string;
}

// The signed accept the client submits. buyerAuthEntryXdr is echoed VERBATIM from prepare (SEC-6); the assertion
// fields are opaque base64url passed through, never parsed for trust. The shipped AcceptDto declares EXACTLY
// these five fields — `credentialId` is NOT accepted (the backend's forbidNonWhitelisted ValidationPipe 400s any
// extra field), so it is deliberately absent here (PR #49 reconciliation).
export interface SubmitAcceptInput {
  quoteId: string;
  buyerAuthEntryXdr: string; // verbatim from prepare (NOT a full txXdr)
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

// Frozen server-action signatures — the client hooks compile against these with mocked actions. Bind the real
// actions with `satisfies` (plan D2) so a drifted signature fails to compile. The Idempotency-Key is a plain
// positional argument routed to the service header (never a FormData field / body).
export type RfqDetailAction = (rfqId: string) => Promise<RfqDetailResult>;
export type PrepareAcceptAction = (
  rfqId: string,
  input: AcceptInput,
  idempotencyKey: string,
) => Promise<PrepareAcceptResult>;
export type SubmitAcceptAction = (
  rfqId: string,
  input: SubmitAcceptInput,
  idempotencyKey: string,
) => Promise<SubmitAcceptResult>;
export type PollMyTradeAction = (rfqId: string) => Promise<MyTradeResult>;

// ── Public artwork detail (TOV-190 / FR-08.01) ────────────────────────────────────────────────────
// Anonymous SSR artwork page (GET /v1/artworks/:id, backend TOV-189). Response is camelCase + no-store: it
// carries 1h SIGNED CDN URLs (supportingImages, coaSignedUrl) alongside the UNSIGNED passthrough
// primaryImageUrl. Only status ∈ {verified, fractionalized} is ever returned on 200 — anything else (unknown,
// wrong-status, soft-deleted, malformed id) is an identical 404 ARTWORK_NOT_FOUND (no existence oracle).
export type ArtworkStatus = 'verified' | 'fractionalized';

export interface Artwork {
  id: string;
  title: string; // always present, non-empty (backend guarantee; schema trims + min(1))
  year: number | null;
  medium: string | null;
  dimensions: string | null; // free-text display label ("80x120 cm"), not structured pixels
  // NOTE: the backend also returns `artistHandle`, but there is no public artist route to link it to yet, so
  // it is intentionally NOT mapped into the domain (Zod strips it). Add it back in the PR that consumes it.
  artistName: string | null;
  primaryImageUrl: string | null; // UNSIGNED passthrough CDN URL — the only image safe for indexable <head>
  supportingImages: string[]; // pre-sorted signed URLs; [] when none; invalid items dropped (fail-open)
  coaSignedUrl: string | null; // signed PDF or null (no COA on file OR a transient signing failure — same UX)
  custodian: string | null; // public display label only
  status: ArtworkStatus;
}

// The PUBLIC artwork read is tokenless — it can't produce SESSION_EXPIRED. A codeless 404 defaults to
// ARTWORK_NOT_FOUND (its only 404 meaning); everything else folds to RATE_LIMITED / NETWORK_ERROR /
// SERVER_ERROR. Deliberately NOT the shared statusFallbackCode (its 404 → WALLET_NOT_FOUND is nonsensical here).
export type ArtworkReadErrorCode =
  | 'ARTWORK_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

// No `message` arm: the page branches purely on `code` (ARTWORK_NOT_FOUND → notFound(), else → error boundary)
// and never renders service copy — so, unlike OfferingResult, there is no curated-message module.
export type ArtworkResult =
  | { status: 'success'; artwork: Artwork }
  | { status: 'error'; code: ArtworkReadErrorCode };

// ── Public artwork provenance timeline (TOV-192 / FR-08.02+08.03) ────────────────────────────────────
// Backend TOV-191: anonymous, camelCase, cursor-paginated, `Cache-Control: no-store`. Two visibility tiers;
// only `fractionalization` + `secondary_trade` are emitted today, the rest are schema-only (future tickets).

// The nine known event types. `fractionalization` + `secondary_trade` have bespoke cards; the other 7 (and any
// UNKNOWN future type) render the generic card — so the domain union is OPEN (`| (string & {})`): the wire
// schema accepts any non-empty string and the card switch owns known-vs-generic. Widening the enum here would
// re-close it and DROP unknown types (defeating the fail-open/generic-fallback goal).
export type KnownEventType =
  | 'fractionalization'
  | 'secondary_trade'
  | 'artwork_verification'
  | 'exhibition'
  | 'loan'
  | 'condition_report'
  | 'admin_note'
  | 'technical'
  | 'attestation';
export type TimelineEventType = KnownEventType | (string & {});

// CLOSED contract (unlike eventType): the two-tier bucketing has no "unknown" bucket, so an unrecognized tier
// is genuine drift and the event is dropped at parse.
export type TimelineVisibilityTier = 'default' | 'expanded';

// Branded validated-string types. The ONLY constructor is a seam mint past `positiveIntString`; both stay plain
// strings at runtime (a BigInt egress would throw across the Flight boundary) — the brand just makes `Number(x)`
// a reviewable smell. `Stroops` is a MONETARY i128/stroop amount (→ formatUsdc); `PositiveIntString` is a plain
// validated count (→ formatCount) that is NOT money — kept distinct so a `fractionCount` never reads as an amount.
export type Stroops = string & { readonly __brand: 'Stroops' };
export type PositiveIntString = string & { readonly __brand: 'PositiveIntString' };

// Public-safe, per-type metadata (never PII). fractionalization = system contract-deploy tx (carries txHash);
// secondary_trade = trade facts WITHOUT txHash (locked payload decision — a trade txHash deanonymizes the
// counterparties). Monetary/count fields are branded strings — never parsed as JS numbers.
export interface FractionalizationMeta {
  tokenAddress: string;
  deployLedger: number;
  txHash: string;
}
export interface SecondaryTradeMeta {
  fractionCount: PositiveIntString; // a count, not money
  pricePerFractionStroops: Stroops; // monetary i128/stroop amount
  settledAt: string; // ISO-8601
}

interface TimelineEventBase {
  id: string; // uuid — stable React key
  visibilityTier: TimelineVisibilityTier;
  occurredAt: string; // ISO-8601 UTC ms; the sort key; formatted deterministically at render
  summary: string | null; // human-readable; may be null
}

// Discriminated on eventType so the card layer narrows `metadata` with ZERO casts. The generic arm carries raw
// metadata for the 7 known-future types + any unknown type. A bad per-type metadata degrades to this generic
// arm in the mapper (kept, not dropped).
export type TimelineEvent =
  | (TimelineEventBase & { eventType: 'fractionalization'; metadata: FractionalizationMeta })
  | (TimelineEventBase & { eventType: 'secondary_trade'; metadata: SecondaryTradeMeta })
  | (TimelineEventBase & { eventType: TimelineEventType; metadata: Record<string, unknown> });

// Local error taxonomy — deliberately NOT the shared statusFallbackCode (its 404 → WALLET_NOT_FOUND is
// nonsensical here). INVALID_CURSOR maps the backend's TIMELINE_INVALID_CURSOR (400).
export type TimelineReadErrorCode =
  | 'ARTWORK_NOT_FOUND'
  | 'INVALID_CURSOR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

// `droppedCount` = per-item parse failures on THIS page (surfaced as a non-blocking notice; the client
// accumulates it across pages). `nextCursor: null` = last page. `events: []` with a 200 is a visible artwork
// with no provenance yet (distinct from a 404).
export type TimelineResult =
  | {
      status: 'success';
      events: TimelineEvent[];
      nextCursor: string | null;
      additionalEventsCount: number;
      droppedCount: number;
    }
  | { status: 'error'; code: TimelineReadErrorCode };

// ── Profile settings (TOV-35 / FR-01.09, backend TOV-30) ─────────────
// The editable "my profile" surface: bio/statement/social links + an async avatar pipeline. Distinct
// from the public-profile `CollectorProfile` above (that's another user's read-only view). Fields are
// camelCase; the backend does a PARTIAL update (only sent keys touched), so callers send ONLY the
// changed, whitelisted keys — NestJS forbidNonWhitelisted 400s any undeclared field.

export type SocialLinks = { twitter?: string; instagram?: string; website?: string };
export type ProfileImageUrls = { thumbUrl: string; cardUrl: string; heroUrl: string };
export type ProfileImageStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type MeProfile = {
  id: string;
  email: string | null;
  handle: string | null;
  bio: string | null; // <= 300 UTF-16 code units
  statement: string | null; // <= 500 UTF-16 code units
  socialLinks: SocialLinks | null;
  profileImage: ProfileImageUrls | null; // null until an active avatar is READY
};

// RATE_LIMITED lives in the TRANSPORT union: a 429 is a bare status (no errorCode body), so it's reached
// via the status-fallback, never a Record<BackendCode, true> passthrough. Mirrors BidTransportErrorCode.
export type ProfileTransportErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

export type GetProfileResult =
  | { status: 'success'; profile: MeProfile }
  | { status: 'error'; code: ProfileTransportErrorCode; message: string };

// VALIDATION_FAILED stays a backend code here (unlike handle/wallet, which collapse it to SERVER_ERROR)
// because a 422 carries per-field errors the form renders inline.
export type ProfileUpdateBackendErrorCode =
  | 'VALIDATION_FAILED'
  | 'PROFILE_IMAGE_NOT_READY'
  | 'PROFILE_IMAGE_NOT_FOUND';

export type ProfileUpdateErrorCode = ProfileUpdateBackendErrorCode | ProfileTransportErrorCode;

export type UpdateProfileResult =
  | { status: 'success'; profile: MeProfile }
  // `fieldPaths` are the dotted paths of the invalid fields (bio, statement, socialLinks.twitter, …). Only
  // the PATHS cross the boundary — the raw backend message strings are dropped server-side so they can't
  // egress; the UI renders CURATED copy keyed by path (see profileSettingsMessages).
  | {
      status: 'error';
      code: ProfileUpdateErrorCode;
      message: string;
      fieldPaths?: string[];
    };

// The signed-upload target the client PUTs bytes to. `token` is already inside `url` (?token=…), so the
// client needs only url + headers; auth is the query token, never an Authorization header.
export type AvatarUploadTarget = {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
};

export type RequestAvatarResult =
  | { status: 'success'; profileImageId: string; upload: AvatarUploadTarget }
  | { status: 'error'; code: ProfileTransportErrorCode; message: string };

// 409 ALREADY_COMMITTED is absorbed into commit's SUCCESS arm (idempotent replay), so it is not a code here.
export type AvatarCommitBackendErrorCode =
  | 'PROFILE_IMAGE_NOT_FOUND'
  | 'PROFILE_UPLOAD_EXPIRED'
  | 'PROFILE_UPLOAD_NOT_FOUND'
  | 'PROFILE_IMAGE_TOO_LARGE'
  | 'PROFILE_IMAGE_INVALID';

export type AvatarCommitErrorCode = AvatarCommitBackendErrorCode | ProfileTransportErrorCode;

export type CommitAvatarResult =
  | { status: 'success'; profileImageId: string; imageStatus: ProfileImageStatus }
  | { status: 'error'; code: AvatarCommitErrorCode; message: string };

export type AvatarStatusResult =
  | { status: 'success'; profileImageId: string; imageStatus: ProfileImageStatus }
  | { status: 'error'; code: ProfileTransportErrorCode; message: string };

// Client-only pipeline machine. `timedOut`/`failed` are distinct STATES (different UX: keep vs clear the
// preview), not error codes. `error` carries the phase so the UI can label the failure without switching
// on a raw, phase-ambiguous code.
export type AvatarPipelineErrorCode =
  | AvatarCommitErrorCode
  | ProfileUpdateErrorCode
  | 'UPLOAD_FAILED';

export type AvatarUploadState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'uploading' }
  | { status: 'committing' }
  | { status: 'processing'; attempts: number }
  | { status: 'activating' }
  | { status: 'active' }
  | { status: 'removing' }
  | { status: 'timedOut'; attempts: number } // preview KEPT + "Check again" re-arms
  | { status: 'failed'; reason: 'processing' } // preview cleared + restart from file pick
  // Error variants correlate `phase` with the codes that phase can actually produce, so an illegal combo
  // (e.g. { phase: 'upload', code: 'PROFILE_IMAGE_NOT_READY' }) is unrepresentable.
  | { status: 'error'; phase: 'request'; code: ProfileTransportErrorCode; message: string }
  | { status: 'error'; phase: 'upload'; code: 'UPLOAD_FAILED'; message: string }
  | { status: 'error'; phase: 'commit'; code: AvatarCommitErrorCode; message: string }
  | { status: 'error'; phase: 'activate'; code: ProfileUpdateErrorCode; message: string };

// The useAvatarUpload hook's return contract (mirrors UseProfileFormReturn / UseWalletExportReturn).
export interface UseAvatarUploadReturn {
  state: AvatarUploadState;
  previewUrl: string | null;
  activeImage: ProfileImageUrls | null;
  selectFile: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
  retry: () => void;
}

// ── Beneficiary designation (TOV-46 / FR-01.10, backend TOV-31) ─────────────
// The single, owner-scoped inheritance beneficiary. GET/POST(full-replace upsert)/DELETE on
// /v1/me/beneficiary. camelCase; POST is FULL-REPLACE (PUT) semantics — an omitted optional is cleared
// to null, so the client always sends all five keys (NestJS forbidNonWhitelisted whitelists exactly them).
// name/relationship/notes are UNTRUSTED third-party free text — render output-encoded (React text nodes),
// never raw. The `notice` is informational only (designating does NOT require KYC).

export type Beneficiary = {
  id: string;
  name: string;
  email: string;
  stellarPubkey: string | null;
  relationship: string | null;
  notes: string | null;
  createdAt: string; // ISO-8601 UTC
  updatedAt: string;
};

// KYC notice: present iff kyc_status !== 'whitelisted'. The `code` is stable; the FE switches on it and
// supplies its own curated copy — the backend `message` is DROPPED at the service so it never egresses.
export type BeneficiaryNotice = { code: 'KYC_REQUIRED_FOR_TRANSFER' };

// RATE_LIMITED lives in the TRANSPORT union (a 429 is a bare status, reached via the status fallback).
export type BeneficiaryTransportErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';

// The only backend code for the write path: a 400 VALIDATION_FAILED (bare NestJS `message: string[]`, no
// per-field map). It is reached purely by the service's 400 STATUS fallback (`writeStatusFallback`) — there
// is deliberately NO `Record<…, true>` passthrough map (unlike profile), because a single status-derived
// code needs none. Kept as a named one-member union only to mirror the Backend/Transport split shape.
export type BeneficiaryWriteBackendErrorCode = 'VALIDATION_FAILED';
export type BeneficiaryErrorCode = BeneficiaryWriteBackendErrorCode | BeneficiaryTransportErrorCode;

// Shared success arm — one place to change the success shape. `beneficiary: null` is the empty state (GET
// never 404s) or the post-delete state; `notice: null` iff the Collector is whitelisted.
type BeneficiarySuccess = {
  status: 'success';
  beneficiary: Beneficiary | null;
  notice: BeneficiaryNotice | null;
};

// GET can't return the write-only VALIDATION_FAILED → transport union only.
export type GetBeneficiaryResult =
  | BeneficiarySuccess
  | { status: 'error'; code: BeneficiaryTransportErrorCode; message: string };

export type WriteBeneficiaryResult =
  | BeneficiarySuccess
  | { status: 'error'; code: BeneficiaryErrorCode; message: string };
