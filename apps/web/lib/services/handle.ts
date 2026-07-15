import 'server-only';

import { z } from 'zod/v4';
import { postJson, getJson, extractBackendCode, statusFallbackCode } from '@/lib/services/http';
import { HANDLE_MESSAGES } from '@/lib/handle/handleMessages';
import type {
  SetHandleResult,
  SetHandleErrorCode,
  GetHandleResult,
  GetHandleErrorCode,
} from '@/lib/types/api';

// Authenticated handle operations (TOV-43 / FR-01.05): commit (upsert) and read the caller's handle.
// The availability CHECK is NOT here — it is a public, tokenless GET called directly from the browser
// (lib/handle/checkHandle.ts) so the backend's per-IP throttle keys on the real client IP. Uses the
// shared http.ts seam; a raw backend message is never surfaced — only curated HANDLE_MESSAGES copy.

const SET_HANDLE_TIMEOUT_MS = 10_000;
const GET_HANDLE_TIMEOUT_MS = 10_000;

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// ── Commit (set / change) a handle ────────────────

const setHandleResponseSchema = z.object({
  handle: z.string(),
  handleCanonical: z.string(),
});

// Keyed on the union so a new SetHandleErrorCode fails to compile until classified. A `false` return
// means "not backend-sent, use the HTTP-status fallback", not "invalid code" (see isPassthroughAddCode).
const IS_SET_HANDLE_BACKEND_CODE: Record<SetHandleErrorCode, boolean> = {
  HANDLE_TAKEN: true, // 409 (lost a TOCTOU race after a green check)
  HANDLE_FORMAT_INVALID: true, // 422
  HANDLE_RESERVED: true, // 422
  RATE_LIMITED: true, // 429
  SESSION_EXPIRED: false, // HTTP 401 fallback
  NETWORK_ERROR: false, // status-0 fallback
  SERVER_ERROR: false, // HTTP fallback
};

function isPassthroughSetHandleCode(code: string): code is SetHandleErrorCode {
  return (
    Object.prototype.hasOwnProperty.call(IS_SET_HANDLE_BACKEND_CODE, code) &&
    IS_SET_HANDLE_BACKEND_CODE[code as SetHandleErrorCode]
  );
}

// Status → SetHandleErrorCode fallback. Delegates to the shared statusFallbackCode and narrows to this
// union: the statuses it maps outside the union are 400 → VALIDATION_FAILED (the handle is
// schema-validated in the action) and 404 → WALLET_NOT_FOUND (irrelevant here); both collapse to
// SERVER_ERROR. Mirrors removeStatusFallback.
function setHandleStatusFallback(status: number): SetHandleErrorCode {
  const code = statusFallbackCode(status);
  if (code === 'VALIDATION_FAILED' || code === 'WALLET_NOT_FOUND') return 'SERVER_ERROR';
  return code;
}

function mapSetHandleError(
  status: number,
  data: unknown,
): { code: SetHandleErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code =
    backendCode && isPassthroughSetHandleCode(backendCode)
      ? backendCode
      : setHandleStatusFallback(status);
  return { code, message: HANDLE_MESSAGES[code] };
}

// Set/change the caller's handle. Upsert — re-submitting the current handle is a 200 no-op success.
// 200 → { handle (stored casing), handleCanonical (lowercase key) }.
export async function setHandle(accessToken: string, handle: string): Promise<SetHandleResult> {
  const outcome = await postJson(
    '/v1/me/handle',
    { handle },
    { timeoutMs: SET_HANDLE_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) return { status: 'error', ...mapSetHandleError(outcome.status, outcome.data) };

  // Validate the 200 body defensively, but the fields aren't returned — the action redirects on
  // success, so no consumer exists (see SetHandleResult).
  if (!setHandleResponseSchema.safeParse(outcome.data).success) {
    return { status: 'error', code: 'SERVER_ERROR', message: HANDLE_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success' };
}

// ── Read the caller's current handle ──────────────

// Tolerant read (forward-compatible): unknown backend fields are stripped by Zod's default parse; a
// missing/undefined/empty handle collapses to null so "no handle" is a single shape both the home guard
// (`=== null`) and the onboarding page (falsy) treat identically (todo 104).
const getHandleResponseSchema = z.object({
  handle: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null)),
});

function getHandleStatusFallback(status: number): GetHandleErrorCode {
  const code = statusFallbackCode(status);
  if (code === 'SESSION_EXPIRED') return 'SESSION_EXPIRED';
  if (code === 'NETWORK_ERROR') return 'NETWORK_ERROR';
  return 'SERVER_ERROR';
}

// Read the current handle (null when unclaimed). Used on onboarding entry to auto-skip a returning
// user who already has a handle.
export async function getHandle(accessToken: string): Promise<GetHandleResult> {
  const outcome = await getJson('/v1/me/handle', {
    timeoutMs: GET_HANDLE_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (!outcome.ok) return { status: 'error', code: getHandleStatusFallback(outcome.status) };

  const parsed = getHandleResponseSchema.safeParse(outcome.data);
  if (!parsed.success) return { status: 'error', code: 'SERVER_ERROR' };

  return { status: 'success', handle: parsed.data.handle };
}
