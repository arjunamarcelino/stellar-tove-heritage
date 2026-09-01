import 'server-only';

import { getJson, postJson, deleteJson } from '@/lib/services/http';
import { BENEFICIARY_MESSAGES } from '@/lib/beneficiary/beneficiaryMessages';
import { BENEFICIARY_TIMEOUT_MS } from '@/lib/beneficiary/constants';
import { beneficiaryEnvelopeSchema } from '@/lib/beneficiary/schemas';
import type { BeneficiaryWriteBody } from '@/lib/beneficiary/schemas';
import type {
  BeneficiaryNotice,
  BeneficiaryTransportErrorCode,
  BeneficiaryErrorCode,
  GetBeneficiaryResult,
  WriteBeneficiaryResult,
} from '@/lib/types/api';

// Authenticated beneficiary-designation surface (TOV-46 / FR-01.10, backend TOV-31): read the single
// owner-scoped beneficiary (GET /v1/me/beneficiary), full-replace upsert it (POST — all five whitelisted
// keys), and delete it (DELETE, idempotent). Uses the shared http.ts seam (getJson/postJson/deleteJson).
// A raw backend `message` is NEVER surfaced — every error maps to a code and the UI shows only curated copy
// from beneficiaryMessages.ts; the informational KYC `notice` is narrowed to its stable code (its backend
// message is DROPPED here, security F2). Mirrors lib/services/profile.ts (dedicated status fallbacks +
// defensive envelope parse → SERVER_ERROR on drift, no leak).

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// ── Dedicated status fallbacks (NOT the shared statusFallbackCode — it maps 404 → WALLET_NOT_FOUND) ──

// GET / DELETE reads: a 429 is a bare status (no errorCode body). No 400 → VALIDATION_FAILED here: a GET
// can't return a validation failure, and DELETE has no request body to validate.
function getStatusFallback(status: number): BeneficiaryTransportErrorCode {
  switch (status) {
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

// The write path (POST full-replace) adds 400 → VALIDATION_FAILED: a bare NestJS ValidationPipe rejection is
// a 400 with `{ message: string[] }` and no errorCode. Mapping it to VALIDATION_FAILED surfaces the curated
// validation copy (the client re-validates for inline field errors); everything else mirrors getStatusFallback.
function writeStatusFallback(status: number): BeneficiaryErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
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

// Narrow the parsed (lenient) notice to the known domain literal. An unknown/absent code degrades to null
// ("no banner") rather than failing the read. The backend `message` is DROPPED here — only the stable code
// crosses the trust boundary (security F2: no raw backend string egresses to the client).
function toNotice(raw: { code: string; message?: string } | null): BeneficiaryNotice | null {
  return raw?.code === 'KYC_REQUIRED_FOR_TRANSFER' ? { code: 'KYC_REQUIRED_FOR_TRANSFER' } : null;
}

// ── GET /v1/me/beneficiary — read the single beneficiary ──

// Per-user authed read — never route-cache (CLAUDE.md seam contract); explicit no-store. GET never 404s
// (an empty state is `beneficiary: null`). Transport-only error union.
export async function getBeneficiary(accessToken: string): Promise<GetBeneficiaryResult> {
  const outcome = await getJson('/v1/me/beneficiary', {
    timeoutMs: BENEFICIARY_TIMEOUT_MS,
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });

  if (!outcome.ok) {
    const code = getStatusFallback(outcome.status);
    return { status: 'error', code, message: BENEFICIARY_MESSAGES[code] };
  }

  const parsed = beneficiaryEnvelopeSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: BENEFICIARY_MESSAGES.SERVER_ERROR };
  }

  return {
    status: 'success',
    beneficiary: parsed.data.beneficiary,
    notice: toNotice(parsed.data.notice),
  };
}

// ── POST /v1/me/beneficiary — full-replace upsert ──

// FULL-REPLACE (PUT) semantics: the body carries exactly the five whitelisted keys (a blank optional is
// null). A 400 falls back to VALIDATION_FAILED; the curated copy is shown (extractBackendMessage is NOT
// used — it joins the backend's raw `message: string[]`, which must never egress). Returns the saved row.
export async function setBeneficiary(
  accessToken: string,
  body: BeneficiaryWriteBody,
): Promise<WriteBeneficiaryResult> {
  const outcome = await postJson('/v1/me/beneficiary', body, {
    timeoutMs: BENEFICIARY_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (!outcome.ok) {
    const code = writeStatusFallback(outcome.status);
    return { status: 'error', code, message: BENEFICIARY_MESSAGES[code] };
  }

  const parsed = beneficiaryEnvelopeSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: BENEFICIARY_MESSAGES.SERVER_ERROR };
  }

  return {
    status: 'success',
    beneficiary: parsed.data.beneficiary,
    notice: toNotice(parsed.data.notice),
  };
}

// ── DELETE /v1/me/beneficiary — remove the beneficiary (idempotent) ──

// DEFENSIVE idempotency: a 404 means there was nothing to delete, which is the caller's desired end state, so
// it resolves to success (empty). A genuine 204/empty body makes res.json() throw → data:null (see http.ts
// deleteJson) and also resolves to success. Other failures fall back by status (DELETE has no 400 body).
export async function removeBeneficiary(accessToken: string): Promise<WriteBeneficiaryResult> {
  const outcome = await deleteJson('/v1/me/beneficiary', {
    timeoutMs: BENEFICIARY_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (!outcome.ok) {
    if (outcome.status === 404) {
      return { status: 'success', beneficiary: null, notice: null };
    }
    const code = getStatusFallback(outcome.status);
    return { status: 'error', code, message: BENEFICIARY_MESSAGES[code] };
  }

  // A 204/empty body resolves to data:null (deleteJson) → the delete succeeded with no envelope.
  if (outcome.data === null) {
    return { status: 'success', beneficiary: null, notice: null };
  }

  const parsed = beneficiaryEnvelopeSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: BENEFICIARY_MESSAGES.SERVER_ERROR };
  }

  return {
    status: 'success',
    beneficiary: parsed.data.beneficiary,
    notice: toNotice(parsed.data.notice),
  };
}
