import 'server-only';

import type { StatusFallbackCode } from '@/lib/types/api';

// Shared HTTP-status → error-code fallback used by services when the backend sends no usable
// `errorCode`. Centralized so the mapping lives in one place (todo 067).
export function statusFallbackCode(status: number): StatusFallbackCode {
  switch (status) {
    case 0:
      return 'NETWORK_ERROR';
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'SESSION_EXPIRED';
    case 404:
      return 'WALLET_NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'SERVER_ERROR';
  }
}

// Shared fetch seam for services calling the Express backend (plan A3). Collapses the repeated
// env-guard → try/catch → defensive res.json() skeleton. `status: 0` means the request never
// produced a usable HTTP response (missing config, network failure, or unparseable body) — callers
// map that to NETWORK_ERROR/SERVER_ERROR.
export type PostJsonOutcome =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; data: unknown };

// The seam is `Authorization`-agnostic: authenticated callers pass a Bearer header via `opts.headers`
// (mirrors the hand-rolled fetch in lib/services/auth.ts fetchProfile). The token stays in the
// header — never smuggle it into the JSON body, where it could land in backend request logs.
type RequestOpts = { timeoutMs?: number; headers?: Record<string, string> };

// Shared request core for postJson/getJson. Same env-guard → try/catch → defensive res.json()
// contract; `status: 0` = no usable HTTP response (missing config, network failure, unparseable body).
async function requestJson(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  opts?: RequestOpts,
): Promise<PostJsonOutcome> {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) return { ok: false, status: 0, data: null };

  const headers: Record<string, string> = { ...opts?.headers };
  if (method === 'POST') headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      // On-chain work (contract deploy / settlement) can take many seconds, so callers pass a
      // generous timeout; an abort surfaces as status 0 → NETWORK_ERROR.
      signal: opts?.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function postJson(
  path: string,
  body: unknown,
  opts?: RequestOpts,
): Promise<PostJsonOutcome> {
  return requestJson('POST', path, body, opts);
}

// Authenticated reads (e.g. the wallet list / export status) — GET with a Bearer header and no body.
export function getJson(path: string, opts?: RequestOpts): Promise<PostJsonOutcome> {
  return requestJson('GET', path, undefined, opts);
}

// Authenticated deletes (e.g. removing a BYOW wallet) — DELETE with a Bearer header and no body. The
// body is read defensively: a 200 with a JSON body (TOV-25 me/wallets returns { deletedId,
// newPrimaryWalletId }) resolves to { ok: true, status: 200, data: <body> }, while a genuine 204/empty
// body makes res.json() throw and the defensive catch above sets data = null. Don't "fix" that catch
// to rethrow. A transport failure/timeout collapses to status 0.
export function deleteJson(path: string, opts?: RequestOpts): Promise<PostJsonOutcome> {
  return requestJson('DELETE', path, undefined, opts);
}

// ── Shared backend error-body helpers ─────────────
// Backend error bodies vary but converge on { message?, fieldErrors?, code?/errorCode? }. These
// read them defensively from an `unknown` response body (used by passkey/wallet/auth services).

export function extractBackendCode(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const d = data as { errorCode?: unknown; code?: unknown };
    if (typeof d.errorCode === 'string') return d.errorCode;
    if (typeof d.code === 'string') return d.code;
  }
  return undefined;
}

export function extractBackendMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) {
      const joined = m.filter((x): x is string => typeof x === 'string').join('. ');
      if (joined) return joined;
    }
  }
  return fallback;
}

export function extractFieldErrors(data: unknown): Record<string, string> | undefined {
  if (!data || typeof data !== 'object' || !('fieldErrors' in data)) return undefined;
  const raw = (data as { fieldErrors?: unknown }).fieldErrors;
  if (!raw || typeof raw !== 'object') return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value;
    else if (Array.isArray(value)) {
      result[key] = value.filter((x): x is string => typeof x === 'string').join('. ');
    }
  }
  return Object.keys(result).length ? result : undefined;
}
