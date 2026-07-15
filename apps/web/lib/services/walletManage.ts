import 'server-only';

import { z } from 'zod/v4';
import { postJson, deleteJson, extractBackendCode, statusFallbackCode } from '@/lib/services/http';
import { walletObjectSchema } from '@/lib/services/wallets';
import {
  ADD_WALLET_MESSAGES,
  REMOVE_WALLET_MESSAGES,
  SET_PRIMARY_WALLET_MESSAGES,
} from '@/lib/wallet/manageMessages';
import type {
  AddWalletChallengeResult,
  AddWalletResult,
  AddWalletErrorCode,
  RemoveWalletResult,
  RemoveWalletErrorCode,
  SetPrimaryWalletResult,
  SetPrimaryWalletErrorCode,
} from '@/lib/types/api';

// The full TOV-24 wallet-management surface (FR-01.03): add a BYOW wallet (2-step SEP-10) and remove
// one (DELETE). Distinct from walletConnect.ts (SEP-10 login) and walletExport.ts (embedded
// offboarding). Uses the shared http.ts seam. There is NO SAFE_PASSTHROUGH_CODES set — a backend
// message is never surfaced (SEP-10 errors can echo XDR/internal addresses); the UI only ever shows
// curated copy from manageMessages.ts.

const CHALLENGE_TIMEOUT_MS = 15_000;
const ADD_TIMEOUT_MS = 20_000; // must exceed backend SEP-10 verify p99 so a timeout means "response
// lost" (a retry-send with the same key replays the original 201) rather than "still processing".
const REMOVE_TIMEOUT_MS = 10_000;

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// ── Add a BYOW wallet (2-step SEP-10) ─────────────

const challengeSchema = z.object({
  challengeTxXdr: z.string(),
  networkPassphrase: z.string(),
});

// Keyed on the union so a new AddWalletErrorCode fails to compile until classified. The backend sends
// distinct codes for the two idempotency conditions (TOV-24 PR #26), so both pass through directly —
// no status-based synthesis needed.
const IS_ADD_BACKEND_CODE: Record<AddWalletErrorCode, boolean> = {
  VALIDATION_FAILED: true, // 400
  AUTH_SIGNATURE_INVALID: true, // 401
  AUTH_CHALLENGE_NOT_FOUND: true, // 401
  AUTH_CHALLENGE_EXPIRED: true, // 401
  AUTH_CHALLENGE_ALREADY_USED: true, // 401
  WALLET_ALREADY_BOUND: true, // 409 (bound to another collector)
  IDEMPOTENCY_KEY_IN_FLIGHT: true, // 409 (same key still processing → retry-send)
  IDEMPOTENCY_KEY_MISMATCH: true, // 422 (same key, different body → restart)
  RATE_LIMITED: true, // 429
  SESSION_EXPIRED: false, // HTTP 401 fallback
  NETWORK_ERROR: false, // status-0 fallback
  SERVER_ERROR: false, // HTTP fallback
};

// True only for codes the backend is authoritative for (passed through verbatim). A `false` return
// does NOT mean the string is an invalid AddWalletErrorCode — it means "not backend-sent, use the
// HTTP-status fallback instead" (e.g. SESSION_EXPIRED/NETWORK_ERROR/SERVER_ERROR are false here).
function isPassthroughAddCode(code: string): code is AddWalletErrorCode {
  return (
    Object.prototype.hasOwnProperty.call(IS_ADD_BACKEND_CODE, code) &&
    IS_ADD_BACKEND_CODE[code as AddWalletErrorCode]
  );
}

// Status → AddWalletErrorCode fallback. Intentionally NOT delegated to the shared statusFallbackCode:
// this flow maps 400 → VALIDATION_FAILED (an add-only code) and must never emit WALLET_NOT_FOUND
// (which statusFallbackCode returns for 404, and which isn't in AddWalletErrorCode).
function addStatusFallback(status: number): AddWalletErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    // A 401 falls back to SESSION_EXPIRED (terminal → re-login). This relies on the backend contract
    // that signature/challenge failures ALWAYS carry a precise `errorCode` (AUTH_SIGNATURE_INVALID /
    // AUTH_CHALLENGE_*), which is passed through before this fallback runs (TOV-24 confirmed the error
    // envelope always includes errorCode). If that guarantee ever weakens, a bad signature would be
    // mis-shown as session expiry — split this case then.
    case 401:
      return 'SESSION_EXPIRED';
    case 429:
      return 'RATE_LIMITED';
    case 0:
      return 'NETWORK_ERROR';
    default:
      return 'SERVER_ERROR';
  }
}

function mapAddError(status: number, data: unknown): { code: AddWalletErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code =
    backendCode && isPassthroughAddCode(backendCode) ? backendCode : addStatusFallback(status);
  return { code, message: ADD_WALLET_MESSAGES[code] };
}

// Step A: request a user-bound SEP-10 challenge for the given Stellar public key.
export async function addWalletChallenge(
  accessToken: string,
  publicKey: string,
): Promise<AddWalletChallengeResult> {
  const outcome = await postJson(
    '/v1/me/wallets/challenge',
    { publicKey },
    { timeoutMs: CHALLENGE_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) return { status: 'error', ...mapAddError(outcome.status, outcome.data) };

  const parsed = challengeSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ADD_WALLET_MESSAGES.SERVER_ERROR };
  }

  return {
    status: 'success',
    challengeTxXdr: parsed.data.challengeTxXdr,
    networkPassphrase: parsed.data.networkPassphrase,
  };
}

// Step B: submit the client-signed challenge with a client-generated Idempotency-Key (header, never
// body). 201 → the created wallet. The key is stable across a transport-retry of the identical signed
// body (replays the original 201); a new challenge → new signed body → new key (or the same key +
// different body returns 422 → IDEMPOTENCY_KEY_MISMATCH).
export async function addWallet(
  accessToken: string,
  signedChallengeXdr: string,
  idempotencyKey: string,
): Promise<AddWalletResult> {
  const outcome = await postJson(
    '/v1/me/wallets',
    { signedChallengeXdr },
    {
      timeoutMs: ADD_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (!outcome.ok) return { status: 'error', ...mapAddError(outcome.status, outcome.data) };

  const parsed = walletObjectSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ADD_WALLET_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', wallet: parsed.data };
}

// ── Remove (disconnect) a BYOW wallet ─────────────

// Which error codes the backend sends as an `errorCode` (passed through as the code, not the message).
// Keyed on the union — not a Set — so a new RemoveWalletErrorCode fails to compile until classified,
// and a new backend code can't silently fall through to a generic HTTP-status fallback.
const IS_REMOVE_BACKEND_CODE: Record<RemoveWalletErrorCode, boolean> = {
  WALLET_NOT_FOUND: true, // 404 (unknown or not owned — the backend collapses both)
  PRIMARY_WALLET_CANNOT_BE_REMOVED: true, // 409 (sole-primary; UI hides Remove on the primary)
  WALLET_KIND_NOT_SUPPORTED: true, // 422 (embedded → export instead; UI backstop)
  RATE_LIMITED: true, // 429
  SESSION_EXPIRED: false, // HTTP 401 fallback
  NETWORK_ERROR: false, // status-0 fallback
  SERVER_ERROR: false, // HTTP fallback
};

// True only for codes the backend is authoritative for (see isPassthroughAddCode). A `false` return
// means "not backend-sent, use the HTTP-status fallback", not "invalid code".
function isPassthroughRemoveCode(code: string): code is RemoveWalletErrorCode {
  return (
    Object.prototype.hasOwnProperty.call(IS_REMOVE_BACKEND_CODE, code) &&
    IS_REMOVE_BACKEND_CODE[code as RemoveWalletErrorCode]
  );
}

// Status → RemoveWalletErrorCode fallback. Delegates to the shared statusFallbackCode (single source
// of truth) and narrows to the remove union: the only status statusFallbackCode maps outside that
// union is 400 → VALIDATION_FAILED, which this flow can't emit (the id is uuid-validated in the
// action), so it collapses to SERVER_ERROR.
function removeStatusFallback(status: number): RemoveWalletErrorCode {
  const code = statusFallbackCode(status);
  return code === 'VALIDATION_FAILED' ? 'SERVER_ERROR' : code;
}

function mapRemoveError(
  status: number,
  data: unknown,
): { code: RemoveWalletErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code =
    backendCode && isPassthroughRemoveCode(backendCode)
      ? backendCode
      : removeStatusFallback(status);
  return { code, message: REMOVE_WALLET_MESSAGES[code] };
}

// TOV-25 DELETE response: 200 + { deletedId, newPrimaryWalletId } (was 204). Parsed defensively so a
// 200 with a missing/legacy (empty) body still resolves to success with newPrimaryWalletId: null.
const removeResponseSchema = z.object({
  deletedId: z.string(),
  newPrimaryWalletId: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

// Soft-unbind a BYOW wallet. 200 → success (+ the auto-promoted sibling id, or null). The backend
// rejects removing the primary with no eligible sibling (409) or an embedded wallet (422); those are
// UI-hidden but handled here as race/defensive backstops.
export async function removeWallet(
  accessToken: string,
  walletId: string,
): Promise<RemoveWalletResult> {
  const outcome = await deleteJson(`/v1/me/wallets/${encodeURIComponent(walletId)}`, {
    timeoutMs: REMOVE_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (outcome.ok) {
    const parsed = removeResponseSchema.safeParse(outcome.data);
    return {
      status: 'success',
      newPrimaryWalletId: parsed.success ? parsed.data.newPrimaryWalletId : null,
    };
  }

  return { status: 'error', ...mapRemoveError(outcome.status, outcome.data) };
}

// ── Set a wallet as primary ───────────────────────

const SET_PRIMARY_TIMEOUT_MS = 10_000; // a quick DB flip, no on-chain work (parity with remove).

// Keyed on the union so a new SetPrimaryWalletErrorCode fails to compile until classified.
const IS_SET_PRIMARY_BACKEND_CODE: Record<SetPrimaryWalletErrorCode, boolean> = {
  WALLET_NOT_FOUND: true, // 404 (unknown / not owned / soft-deleted — the backend collapses these)
  WALLET_KIND_NOT_SUPPORTED: true, // 422 (target is an active embedded wallet; UI backstop)
  WALLET_NOT_ELIGIBLE_FOR_PRIMARY: true, // 409 (target is exported; UI backstop)
  RATE_LIMITED: true, // 429
  SESSION_EXPIRED: false, // HTTP 401 fallback
  NETWORK_ERROR: false, // status-0 fallback
  SERVER_ERROR: false, // HTTP fallback
};

// True only for codes the backend is authoritative for (see isPassthroughRemoveCode). A `false`
// return means "not backend-sent, use the HTTP-status fallback", not "invalid code".
function isPassthroughSetPrimaryCode(code: string): code is SetPrimaryWalletErrorCode {
  return (
    Object.prototype.hasOwnProperty.call(IS_SET_PRIMARY_BACKEND_CODE, code) &&
    IS_SET_PRIMARY_BACKEND_CODE[code as SetPrimaryWalletErrorCode]
  );
}

// Status → SetPrimaryWalletErrorCode fallback. Delegates to the shared statusFallbackCode and narrows
// to this union: the only status it maps outside the union is 400 → VALIDATION_FAILED (unreachable —
// the id is uuid-validated in the action), so it collapses to SERVER_ERROR. Mirrors removeStatusFallback.
function setPrimaryStatusFallback(status: number): SetPrimaryWalletErrorCode {
  const code = statusFallbackCode(status);
  return code === 'VALIDATION_FAILED' ? 'SERVER_ERROR' : code;
}

function mapSetPrimaryError(
  status: number,
  data: unknown,
): { code: SetPrimaryWalletErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code =
    backendCode && isPassthroughSetPrimaryCode(backendCode)
      ? backendCode
      : setPrimaryStatusFallback(status);
  return { code, message: SET_PRIMARY_WALLET_MESSAGES[code] };
}

// Promote a wallet to primary. 200 (including the idempotent no-op when it's already primary) →
// success. No request body per the contract (postJson stringifies `undefined` to no body); we do NOT
// parse the returned DTO — the panel router.refresh()es to re-read the whole list, since the demoted
// old primary isn't described by this single-wallet response.
export async function setPrimaryWallet(
  accessToken: string,
  walletId: string,
): Promise<SetPrimaryWalletResult> {
  const outcome = await postJson(
    `/v1/me/wallets/${encodeURIComponent(walletId)}/primary`,
    undefined,
    {
      timeoutMs: SET_PRIMARY_TIMEOUT_MS,
      headers: authHeaders(accessToken),
    },
  );

  if (outcome.ok) return { status: 'success' };

  return { status: 'error', ...mapSetPrimaryError(outcome.status, outcome.data) };
}
