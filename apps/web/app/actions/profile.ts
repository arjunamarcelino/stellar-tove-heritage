'use server';

import { readAccessToken } from '@/lib/cookies';
import { profilePatchSchema } from '@/lib/profile/settingsSchemas';
import {
  PROFILE_UPDATE_MESSAGES,
  AVATAR_COMMIT_MESSAGES,
} from '@/lib/profile/profileSettingsMessages';
import {
  updateProfile,
  requestProfileImageUpload,
  commitProfileImage,
  getProfileImageStatus,
} from '@/lib/services/profile';
import type { ProfilePatch } from '@/lib/profile/settingsSchemas';
import type {
  UpdateProfileResult,
  RequestAvatarResult,
  CommitAvatarResult,
  AvatarStatusResult,
} from '@/lib/types/api';

// Thin server actions for the profile-settings surface (TOV-35 / FR-01.09): read the Bearer token from
// the httpOnly cookie (via the shared readAccessToken — never trust a client-passed token), re-validate
// where the client supplies free-form input, delegate to lib/services/profile. These NEVER redirect —
// the client hook decides navigation (on SESSION_EXPIRED it stops polling and router.replace('/login')s).
// The idempotency key is minted on the CLIENT (WS-D); the actions forward the passed key verbatim.

const UPDATE_SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: PROFILE_UPDATE_MESSAGES.SESSION_EXPIRED,
};

const COMMIT_SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: AVATAR_COMMIT_MESSAGES.SESSION_EXPIRED,
};

const UPDATE_VALIDATION_ERROR = {
  status: 'error' as const,
  code: 'VALIDATION_FAILED' as const,
  message: PROFILE_UPDATE_MESSAGES.VALIDATION_FAILED,
};

// Save the text form. Re-validate with profilePatchSchema (defense-in-depth: the client already gated,
// but a Server Action is a public entrypoint) before delegating — a bad shape never reaches the backend.
export async function updateProfileAction(patch: ProfilePatch): Promise<UpdateProfileResult> {
  const token = await readAccessToken();
  if (!token) return UPDATE_SESSION_ERROR;

  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) return UPDATE_VALIDATION_ERROR;

  return updateProfile(token, parsed.data);
}

// Kick off the avatar upload: mint a signed target for the client to PUT bytes to. The client-minted
// Idempotency-Key is forwarded verbatim. Transport-only error union.
export async function requestAvatarUploadAction(
  idempotencyKey: string,
): Promise<RequestAvatarResult> {
  const token = await readAccessToken();
  if (!token) return UPDATE_SESSION_ERROR;
  return requestProfileImageUpload(token, idempotencyKey);
}

// Finalize the uploaded bytes (idempotent — a 409 replay resolves to success in the service).
export async function commitAvatarAction(
  profileImageId: string,
  idempotencyKey: string,
): Promise<CommitAvatarResult> {
  const token = await readAccessToken();
  if (!token) return COMMIT_SESSION_ERROR;
  return commitProfileImage(token, profileImageId, idempotencyKey);
}

// Poll the derivative status while the avatar is `processing`. Transport-only error union.
export async function getAvatarStatusAction(profileImageId: string): Promise<AvatarStatusResult> {
  const token = await readAccessToken();
  if (!token) return UPDATE_SESSION_ERROR;
  return getProfileImageStatus(token, profileImageId);
}

// Activate a READY avatar (or clear it with null) by PATCHing profileImageId onto the profile. Validated
// through the same profilePatchSchema so a malformed id can't reach the backend.
export async function setAvatarAction(profileImageId: string | null): Promise<UpdateProfileResult> {
  const token = await readAccessToken();
  if (!token) return UPDATE_SESSION_ERROR;

  const parsed = profilePatchSchema.safeParse({ profileImageId });
  if (!parsed.success) return UPDATE_VALIDATION_ERROR;

  return updateProfile(token, parsed.data);
}
