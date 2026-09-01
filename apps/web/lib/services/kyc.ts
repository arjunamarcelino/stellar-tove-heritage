import 'server-only';

import { z } from 'zod/v4';
import { getJson, postForm, extractBackendCode } from '@/lib/services/http';
import { KYC_SUBMIT_MESSAGES } from '@/lib/kyc/kycMessages';
import { whitelistReasonCopy } from '@/lib/kyc/whitelistMessages';
import { KYC_STATUS_TIMEOUT_MS, KYC_SUBMIT_TIMEOUT_MS } from '@/lib/kyc/constants';
import type {
  KycStatus,
  KycStatusResult,
  KycSubmitResult,
  KycSubmitErrorCode,
  KycBackendErrorCode,
  KycTransportErrorCode,
  WhitelistStatus,
  WhitelistStatusData,
  WhitelistStatusResult,
} from '@/lib/types/api';

// KYC submission surface (TOV-34 / FR-01.07): read status (GET /v1/me/kyc) and submit documents
// (multipart POST /v1/me/kyc/submissions) against the backend TOV-28. Uses the shared http.ts seam
// (getJson + the new postForm). No raw backend message is ever surfaced — the UI only shows curated
// copy from kycMessages.ts (a KYC pipeline shouldn't leak internal diagnostics).

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

const KYC_STATUSES = [
  'not_submitted',
  'pending_review',
  'approved',
  'rejected',
] as const satisfies readonly KycStatus[];

const SUBMISSION_STATUSES = ['pending_review', 'approved', 'rejected'] as const;

// GET /v1/me/kyc body. `latestSubmission` is .nullish()-tolerant (missing or null both normalize to
// null) so a backend that omits it can't fail safeParse and break the whole page (forward-compat).
const kycStatusResponseSchema = z.object({
  kycStatus: z.enum(KYC_STATUSES),
  latestSubmission: z
    .object({
      submissionId: z.string(),
      status: z.enum(SUBMISSION_STATUSES),
      claimedJurisdiction: z.string(),
      createdAt: z.string(),
    })
    .nullish()
    .transform((v) => v ?? null),
});

// Compile-time guard: the parsed kycStatus must stay assignable to the domain union, so a schema drift
// (e.g. widening past the four members) fails to compile here rather than defeating downstream switches.
type _AssertStatus = z.infer<typeof kycStatusResponseSchema>['kycStatus'] extends KycStatus
  ? true
  : never;
const _assertStatus: _AssertStatus = true;
void _assertStatus;

// 202 submission body.
const kycSubmissionResponseSchema = z.object({
  submissionId: z.string(),
  kycStatus: z.enum(KYC_STATUSES),
});

// Keyed on the backend-code union so a new KycBackendErrorCode fails to compile until classified. Every
// entry is `true` (all 12 backend codes pass through verbatim); the split from KycTransportErrorCode
// keeps the transport fallbacks (SESSION_EXPIRED/NETWORK_ERROR/SERVER_ERROR) out of this map by
// construction, so they can never be mistaken for a passthrough code.
const IS_KYC_BACKEND_CODE: Record<KycBackendErrorCode, true> = {
  JURISDICTION_NOT_ELIGIBLE: true,
  KYC_ALREADY_PENDING: true,
  KYC_ALREADY_APPROVED: true,
  KYC_MISSING_DOCUMENT: true,
  KYC_UNEXPECTED_DOCUMENT: true,
  KYC_UNSUPPORTED_MEDIA_TYPE: true,
  KYC_FILE_TOO_LARGE: true,
  KYC_FILE_EMPTY: true,
  IDEMPOTENCY_KEY_IN_FLIGHT: true,
  IDEMPOTENCY_KEY_MISMATCH: true,
  RATE_LIMITED: true,
  VALIDATION_FAILED: true,
};

// True only for codes the backend is authoritative for. A `false` return means "not backend-sent, use
// the HTTP-status fallback", not "invalid code".
function isPassthroughKycCode(code: string): code is KycBackendErrorCode {
  return Object.prototype.hasOwnProperty.call(IS_KYC_BACKEND_CODE, code);
}

// Status → KycSubmitErrorCode fallback for the submit path. Deliberately NOT the shared
// statusFallbackCode (which maps 404 → WALLET_NOT_FOUND — nonsensical for KYC). 400/429 map to the real
// backend codes so an errorCode-less throttle/validation response still shows the right copy.
function kycSubmitStatusFallback(status: number): KycSubmitErrorCode {
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

// Status → transport-only fallback for the status read (its result union carries no backend codes).
function kycReadStatusFallback(status: number): KycTransportErrorCode {
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 0) return 'NETWORK_ERROR';
  return 'SERVER_ERROR';
}

function mapSubmitError(
  status: number,
  data: unknown,
): { code: KycSubmitErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code =
    backendCode && isPassthroughKycCode(backendCode)
      ? backendCode
      : kycSubmitStatusFallback(status);
  return { code, message: KYC_SUBMIT_MESSAGES[code] };
}

// Read the caller's KYC status + latest-submission metadata. Drives the page gate (already
// pending/approved → blocked/status view instead of the wizard).
export async function getKycStatus(accessToken: string): Promise<KycStatusResult> {
  const outcome = await getJson('/v1/me/kyc', {
    timeoutMs: KYC_STATUS_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (!outcome.ok) {
    const code = kycReadStatusFallback(outcome.status);
    return { status: 'error', code, message: KYC_SUBMIT_MESSAGES[code] };
  }

  const parsed = kycStatusResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: KYC_SUBMIT_MESSAGES.SERVER_ERROR };
  }

  return {
    status: 'success',
    kycStatus: parsed.data.kycStatus,
    latestSubmission: parsed.data.latestSubmission,
  };
}

// Submit the multipart application. The 4 files + claimedJurisdiction live in `formData`; the Bearer
// token and the client-minted Idempotency-Key travel as headers (never the body). A generous timeout
// covers slow-uplink transfer of ~40 MB; an abort collapses to status 0 → NETWORK_ERROR (the retry
// replays the same key). 202 → success.
export async function submitKyc(
  accessToken: string,
  formData: FormData,
  idempotencyKey: string,
): Promise<KycSubmitResult> {
  const outcome = await postForm('/v1/me/kyc/submissions', formData, {
    timeoutMs: KYC_SUBMIT_TIMEOUT_MS,
    headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
  });

  if (!outcome.ok) return { status: 'error', ...mapSubmitError(outcome.status, outcome.data) };

  const parsed = kycSubmissionResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: KYC_SUBMIT_MESSAGES.SERVER_ERROR };
  }

  return {
    status: 'success',
    submissionId: parsed.data.submissionId,
    kycStatus: parsed.data.kycStatus,
  };
}

// ── Whitelist status read (TOV-45 / FR-01.08, backend TOV-29) ─────────────
// GET /v1/me/kyc/status → the on-chain WHITELIST lifecycle (separate from the submission read above).
//
// Wire contract (confirmed with TOV-29, locked): camelCase, and ALL FOUR keys are always present — null
// when N/A. So it's a flat object with nullable fields, NOT a discriminated wire shape. `.nullable()` (key
// required, value string|null) matches that faithfully: a genuinely malformed body missing a key still
// fails safeParse → SERVER_ERROR (drift guard), while a valid null renders gracefully. Strict status enum:
// an unknown/6th status fails too (deliberate, mirrors the submission read). Timestamps are ISO-8601 UTC.
// Derived from the domain union (mirrors KYC_STATUSES) so the wire enum and WhitelistStatus can't silently
// diverge — a typo/added member fails to compile here rather than at runtime.
const WHITELIST_STATUSES = [
  'not_submitted',
  'pending_review',
  'whitelisted',
  'frozen',
  'removed',
] as const satisfies readonly WhitelistStatus[];

const whitelistStatusResponseSchema = z.object({
  status: z.enum(WHITELIST_STATUSES),
  whitelistedAt: z.string().nullable(),
  // Opaque reason CODE for frozen/removed (never raw admin prose). Phase 0 always sends null in prod; the
  // code→copy map is an M12 deliverable (see whitelistMessages.ts) and is resolved server-side in
  // toWhitelistData so the raw code never reaches the client.
  reason: z.string().nullable(),
  lastSubmissionAt: z.string().nullable(),
});

// Compile-time drift guard (mirrors _AssertStatus for KycStatus): the parsed status must stay assignable to
// the domain union, so widening the schema past WhitelistStatus fails to compile here.
type _AssertWhitelistStatus = z.infer<
  typeof whitelistStatusResponseSchema
>['status'] extends WhitelistStatus
  ? true
  : never;
const _assertWhitelistStatus: _AssertWhitelistStatus = true;
void _assertWhitelistStatus;

// Flat wire object → narrowed camelCase domain shape (the card reads only the field that matters per
// state). The switch is exhaustive over the status enum, so adding a state without a mapping fails to
// compile. Dates preserve null (the card degrades gracefully). The frozen/removed reason CODE is resolved to
// curated display copy HERE (server-side) via whitelistReasonCopy — the raw code is never placed on the
// domain object, so it can't egress to the client.
function toWhitelistData(
  parsed: z.infer<typeof whitelistStatusResponseSchema>,
): WhitelistStatusData {
  switch (parsed.status) {
    case 'not_submitted':
      return { status: 'not_submitted' };
    case 'pending_review':
      return { status: 'pending_review', lastSubmissionAt: parsed.lastSubmissionAt };
    case 'whitelisted':
      return { status: 'whitelisted', whitelistedAt: parsed.whitelistedAt };
    case 'frozen':
      return { status: 'frozen', reasonCopy: whitelistReasonCopy('frozen', parsed.reason) };
    case 'removed':
      return { status: 'removed', reasonCopy: whitelistReasonCopy('removed', parsed.reason) };
  }
}

// Read the caller's whitelist status. Drives the FR-01.08 status card; the client polls this (via a server
// action) while pending_review. Transport-only error union — same three fallbacks as getKycStatus.
export async function getWhitelistStatus(accessToken: string): Promise<WhitelistStatusResult> {
  const outcome = await getJson('/v1/me/kyc/status', {
    timeoutMs: KYC_STATUS_TIMEOUT_MS,
    headers: authHeaders(accessToken),
    // Per-user authed read — never route-cache (CLAUDE.md seam contract). Explicit no-store so a future
    // fetch-cache refactor can't serve one collector's whitelist verdict to another (defense-in-depth; the
    // Bearer-header read is uncached by default today).
    cache: 'no-store',
  });

  // Boundary note: the whitelist read reuses KYC_SUBMIT_MESSAGES + kycReadStatusFallback for TRANSPORT-error
  // copy (SESSION_EXPIRED/NETWORK_ERROR/SERVER_ERROR) — identical strings today. A KYC-copy edit therefore
  // also moves whitelist copy; if the two surfaces diverge (or lib/kyc/whitelist* graduates to lib/whitelist/),
  // give the whitelist read its own transport-copy source.
  if (!outcome.ok) {
    const code = kycReadStatusFallback(outcome.status);
    return { status: 'error', code, message: KYC_SUBMIT_MESSAGES[code] };
  }

  const parsed = whitelistStatusResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: KYC_SUBMIT_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', data: toWhitelistData(parsed.data) };
}
