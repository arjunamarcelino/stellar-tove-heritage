import 'server-only';

import { z } from 'zod/v4';
import { getJson, patchJson, postJson, extractBackendCode } from '@/lib/services/http';
import {
  PROFILE_UPDATE_MESSAGES,
  AVATAR_COMMIT_MESSAGES,
} from '@/lib/profile/profileSettingsMessages';
import {
  PROFILE_TIMEOUT_MS,
  AVATAR_REQUEST_TIMEOUT_MS,
  AVATAR_STATUS_TIMEOUT_MS,
} from '@/lib/profile/settingsConstants';
import type { ProfilePatch } from '@/lib/profile/settingsSchemas';
import type { Equals } from '@/lib/types/typeUtils';
import type {
  MeProfile,
  AvatarUploadTarget,
  ProfileImageStatus,
  ProfileTransportErrorCode,
  ProfileUpdateErrorCode,
  ProfileUpdateBackendErrorCode,
  AvatarCommitBackendErrorCode,
  GetProfileResult,
  UpdateProfileResult,
  RequestAvatarResult,
  CommitAvatarResult,
  AvatarStatusResult,
} from '@/lib/types/api';

// Authenticated profile-settings surface (TOV-35 / FR-01.09, backend TOV-30): read the editable "my
// profile" (GET /v1/me), partial-update it (PATCH /v1/me), and drive the async avatar pipeline
// (request signed upload → commit → poll status). Uses the shared http.ts seam (getJson/patchJson/
// postJson). A raw backend `message` is NEVER surfaced — every error is mapped to a code and the UI
// shows only curated copy from profileSettingsMessages.ts. Mirrors lib/services/kyc.ts (error-taxonomy
// split + Record<BackendCode, true> passthrough maps + dedicated status fallbacks + _Assert drift guards).

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

const PROFILE_IMAGE_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
] as const satisfies readonly ProfileImageStatus[];

// Completeness guard (the `satisfies` above only proves each member is valid, not that ALL are present):
// dropping a status here would still compile and silently misclassify a real backend value → SERVER_ERROR.
// Intentionally ONE-WAY (assignability/completeness), NOT the exact-equality `Equals<>` — the array may
// legitimately hold more members than the union in other shapes; here we only assert full coverage.
type _AssertStatusesComplete = ProfileImageStatus extends (typeof PROFILE_IMAGE_STATUSES)[number]
  ? true
  : never;
const _assertStatusesComplete: _AssertStatusesComplete = true;
void _assertStatusesComplete;

// ── Response schemas (defensive; a drift fails safeParse → SERVER_ERROR) ──

const socialLinksResponseSchema = z.object({
  twitter: z.string().optional(),
  instagram: z.string().optional(),
  website: z.string().optional(),
});

const profileImageUrlsResponseSchema = z.object({
  thumbUrl: z.string(),
  cardUrl: z.string(),
  heroUrl: z.string(),
});

// GET /v1/me body. bio/statement/socialLinks/profileImage are all nullable (the profileImage is null
// until an avatar is READY). email/handle are nullable too (a wallet-first account may lack both).
const meProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  handle: z.string().nullable(),
  bio: z.string().nullable(),
  statement: z.string().nullable(),
  socialLinks: socialLinksResponseSchema.nullable(),
  profileImage: profileImageUrlsResponseSchema.nullable(),
});

// Compile-time drift guard (shared Equals<> — exact equality): the parsed body must match the domain
// MeProfile, so widening the schema past the contract fails to compile here rather than defeating a
// downstream consumer.
const _assertMeProfile: Equals<z.infer<typeof meProfileResponseSchema>, MeProfile> = true;
void _assertMeProfile;

// POST /v1/me/profile-image body — the signed upload target the client PUTs bytes to.
const requestUploadResponseSchema = z.object({
  profileImageId: z.string(),
  upload: z.object({
    method: z.literal('PUT'),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
});

const _assertUploadTarget: Equals<
  z.infer<typeof requestUploadResponseSchema>['upload'],
  AvatarUploadTarget
> = true;
void _assertUploadTarget;

// POST /v1/me/profile-image/commit body.
const commitResponseSchema = z.object({
  profileImageId: z.string(),
  status: z.enum(PROFILE_IMAGE_STATUSES),
});

const _assertCommitStatus: Equals<
  z.infer<typeof commitResponseSchema>['status'],
  ProfileImageStatus
> = true;
void _assertCommitStatus;

// GET /v1/me/profile-image/:id body — the poll shape (`id` not `profileImageId` here).
const imageStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(PROFILE_IMAGE_STATUSES),
});

const _assertImageStatus: Equals<
  z.infer<typeof imageStatusResponseSchema>['status'],
  ProfileImageStatus
> = true;
void _assertImageStatus;

// ── Backend-code passthrough maps (keyed on the union so a new code fails to compile until classified) ──

// PATCH /v1/me backend codes. VALIDATION_FAILED stays a backend code (unlike handle/wallet) because its
// 422 carries per-field errors the form renders inline.
const IS_PROFILE_UPDATE_BACKEND_CODE: Record<ProfileUpdateBackendErrorCode, true> = {
  VALIDATION_FAILED: true, // 422 (with errors[])
  PROFILE_IMAGE_NOT_READY: true, // 422
  PROFILE_IMAGE_NOT_FOUND: true, // 404
};

function isPassthroughUpdateCode(code: string): code is ProfileUpdateBackendErrorCode {
  return Object.prototype.hasOwnProperty.call(IS_PROFILE_UPDATE_BACKEND_CODE, code);
}

// Commit backend codes. 409 PROFILE_IMAGE_ALREADY_COMMITTED is NOT here — it is absorbed into the
// success arm (idempotent replay), so it can never reach this map.
const IS_AVATAR_COMMIT_BACKEND_CODE: Record<AvatarCommitBackendErrorCode, true> = {
  PROFILE_IMAGE_NOT_FOUND: true, // 404
  PROFILE_UPLOAD_EXPIRED: true, // 410
  PROFILE_UPLOAD_NOT_FOUND: true, // 422
  PROFILE_IMAGE_TOO_LARGE: true, // 422
  PROFILE_IMAGE_INVALID: true, // 422
};

function isPassthroughCommitCode(code: string): code is AvatarCommitBackendErrorCode {
  return Object.prototype.hasOwnProperty.call(IS_AVATAR_COMMIT_BACKEND_CODE, code);
}

// ── Dedicated status fallbacks (NOT the shared statusFallbackCode — it maps 404 → WALLET_NOT_FOUND) ──

// Transport-only reads (GET /v1/me, POST /v1/me/profile-image, GET status) share this fallback: 429 is a
// bare status (no errorCode body), so RATE_LIMITED is reached here, never via a passthrough map.
function transportStatusFallback(status: number): ProfileTransportErrorCode {
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

// Defensive dual-envelope handling (#222 / plan R1): the custom backend envelope tags validation failures
// with `errorCode: 'VALIDATION_FAILED'` (passthrough), but a DEFAULT NestJS ValidationPipe rejection is a
// bare 400 with `{ message: string[] }` and no errorCode. Mapping 400 → VALIDATION_FAILED here classifies
// that case as a validation failure (surfacing a validation banner) instead of a generic SERVER_ERROR. If
// the body also carries `errors[]`, per-field inline errors still render; otherwise the form shows a
// form-level banner (never a raw backend string). Mirrors kycSubmitStatusFallback's 400 → VALIDATION_FAILED.
function updateStatusFallback(status: number): ProfileUpdateErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    case 401:
      return 'SESSION_EXPIRED';
    case 0:
      return 'NETWORK_ERROR';
    default:
      return 'SERVER_ERROR';
  }
}

// The commit path shares `transportStatusFallback` — its non-passthrough statuses map identically (401/429/0
// → SESSION_EXPIRED/RATE_LIMITED/NETWORK_ERROR, else SERVER_ERROR), and a `ProfileTransportErrorCode` widens
// cleanly into `AvatarCommitErrorCode`. Only the UPDATE path needs its own fallback (it maps 400 →
// VALIDATION_FAILED); commit/read do not, so no dedicated commit fallback is warranted.

// Extract the PATCH 422 invalid-field PATHS from the backend body { errorCode, message, errors: [{field,
// message}] }. Only the dotted `field` paths are kept — the backend's own message strings are DROPPED here
// so they never cross the trust boundary to the client; the UI renders CURATED copy keyed by path (see
// PROFILE_FIELD_MESSAGES). Returns undefined when the body carries no structured per-field errors.
function extractProfileFieldPaths(data: unknown): string[] | undefined {
  if (!data || typeof data !== 'object' || !('errors' in data)) return undefined;
  const raw = (data as { errors?: unknown }).errors;
  if (!Array.isArray(raw)) return undefined;
  const paths: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const field = (entry as { field?: unknown }).field;
    if (typeof field === 'string' && !paths.includes(field)) paths.push(field);
  }
  return paths.length ? paths : undefined;
}

// ── GET /v1/me — read the editable profile ────────────

// Per-user authed read — never route-cache (CLAUDE.md seam contract); explicit no-store so a future
// fetch-cache refactor can't serve one collector's profile to another. Transport-only error union.
export async function getMyProfile(accessToken: string): Promise<GetProfileResult> {
  const outcome = await getJson('/v1/me', {
    timeoutMs: PROFILE_TIMEOUT_MS,
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });

  if (!outcome.ok) {
    const code = transportStatusFallback(outcome.status);
    return { status: 'error', code, message: PROFILE_UPDATE_MESSAGES[code] };
  }

  const parsed = meProfileResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: PROFILE_UPDATE_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', profile: parsed.data };
}

// ── PATCH /v1/me — partial update ─────────────────────

// Apply a partial update (only the sent, whitelisted keys are touched). On a 422 VALIDATION_FAILED the
// per-field errors[] are surfaced as `fieldErrors` (field → message) for inline rendering. PROFILE_IMAGE_
// NOT_READY (422) / PROFILE_IMAGE_NOT_FOUND (404) pass through as codes; everything else falls back by
// status. Returns the updated MeProfile on success.
export async function updateProfile(
  accessToken: string,
  patch: ProfilePatch,
): Promise<UpdateProfileResult> {
  const outcome = await patchJson('/v1/me', patch, {
    timeoutMs: PROFILE_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (!outcome.ok) {
    const backendCode = extractBackendCode(outcome.data);
    const code =
      backendCode && isPassthroughUpdateCode(backendCode)
        ? backendCode
        : updateStatusFallback(outcome.status);
    if (code === 'VALIDATION_FAILED') {
      const fieldPaths = extractProfileFieldPaths(outcome.data);
      return {
        status: 'error',
        code,
        message: PROFILE_UPDATE_MESSAGES[code],
        ...(fieldPaths ? { fieldPaths } : {}),
      };
    }
    return { status: 'error', code, message: PROFILE_UPDATE_MESSAGES[code] };
  }

  const parsed = meProfileResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: PROFILE_UPDATE_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', profile: parsed.data };
}

// ── POST /v1/me/profile-image — request a signed upload target ──

// The client-minted Idempotency-Key rides in a header (never the body); the empty POST just kicks off a
// signed-URL mint. Transport-only error union (no per-field backend codes at this phase).
export async function requestProfileImageUpload(
  accessToken: string,
  idempotencyKey: string,
): Promise<RequestAvatarResult> {
  const outcome = await postJson(
    '/v1/me/profile-image',
    {},
    {
      timeoutMs: AVATAR_REQUEST_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (!outcome.ok) {
    const code = transportStatusFallback(outcome.status);
    return { status: 'error', code, message: PROFILE_UPDATE_MESSAGES[code] };
  }

  const parsed = requestUploadResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: PROFILE_UPDATE_MESSAGES.SERVER_ERROR };
  }

  const target: AvatarUploadTarget = parsed.data.upload;
  return { status: 'success', profileImageId: parsed.data.profileImageId, upload: target };
}

// ── POST /v1/me/profile-image/commit — finalize the uploaded bytes ──

// A 409 PROFILE_IMAGE_ALREADY_COMMITTED is ABSORBED into the success arm: the commit is idempotent, so a
// replay (retry after a dropped response) resolves to the same processing state rather than an error. The
// other codes (404/410/422 variants) pass through; everything else falls back by status.
export async function commitProfileImage(
  accessToken: string,
  profileImageId: string,
  idempotencyKey: string,
): Promise<CommitAvatarResult> {
  const outcome = await postJson(
    '/v1/me/profile-image/commit',
    { profileImageId },
    {
      timeoutMs: AVATAR_REQUEST_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (!outcome.ok) {
    // Idempotent replay: an already-committed upload is a success from the caller's view (the bytes are
    // in the pipeline). We don't have the backend's status here, so report the safe `processing` state.
    if (outcome.status === 409) {
      return { status: 'success', profileImageId, imageStatus: 'processing' };
    }
    const backendCode = extractBackendCode(outcome.data);
    const code =
      backendCode && isPassthroughCommitCode(backendCode)
        ? backendCode
        : transportStatusFallback(outcome.status);
    return { status: 'error', code, message: AVATAR_COMMIT_MESSAGES[code] };
  }

  const parsed = commitResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: AVATAR_COMMIT_MESSAGES.SERVER_ERROR };
  }

  return {
    status: 'success',
    profileImageId: parsed.data.profileImageId,
    imageStatus: parsed.data.status,
  };
}

// ── GET /v1/me/profile-image/:id — poll derivative status ──

// A hung poll must fail fast (dedicated short timeout) so the next tick still fits the processing budget.
// Per-user authed read → no-store. Transport-only error union.
export async function getProfileImageStatus(
  accessToken: string,
  profileImageId: string,
): Promise<AvatarStatusResult> {
  const outcome = await getJson(`/v1/me/profile-image/${profileImageId}`, {
    timeoutMs: AVATAR_STATUS_TIMEOUT_MS,
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });

  if (!outcome.ok) {
    const code = transportStatusFallback(outcome.status);
    return { status: 'error', code, message: PROFILE_UPDATE_MESSAGES[code] };
  }

  const parsed = imageStatusResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: PROFILE_UPDATE_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', profileImageId: parsed.data.id, imageStatus: parsed.data.status };
}
