// Curated, product-safe copy for the profile-settings surface (TOV-35 / FR-01.09). Client-safe (no
// 'server-only'); mirrors lib/kyc/kycMessages.ts. A raw backend `message` is NEVER surfaced — the service
// maps every error to a code and the UI shows only these strings. Distinct from lib/profile/profileMessages.ts
// (PROFILE_COPY), which is the public-profile display copy for a different feature (TOV-44).
//
// Each map is keyed on its error-code union (`Record<Union, string>`) so adding a code fails to compile
// until copy exists — the second half of the "fails to compile until classified" guarantee (the first half
// is the service's Record<BackendCode, true> passthrough map).

import type {
  ProfileUpdateErrorCode,
  AvatarCommitErrorCode,
  AvatarPipelineErrorCode,
} from '@/lib/types/api';

export const PROFILE_UPDATE_MESSAGES: Record<ProfileUpdateErrorCode, string> = {
  VALIDATION_FAILED: 'Please fix the highlighted fields and try again.',
  PROFILE_IMAGE_NOT_READY: 'Your photo is still being processed. Please try again in a moment.',
  PROFILE_IMAGE_NOT_FOUND: 'That photo could not be found. Please upload it again.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  RATE_LIMITED: 'Too many changes too quickly. Please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};

export const AVATAR_COMMIT_MESSAGES: Record<AvatarCommitErrorCode, string> = {
  PROFILE_IMAGE_NOT_FOUND: 'That upload could not be found. Please choose your photo again.',
  PROFILE_UPLOAD_EXPIRED: 'The upload window expired. Please choose your photo again.',
  PROFILE_UPLOAD_NOT_FOUND: 'We didn’t receive your photo. Please choose it again.',
  PROFILE_IMAGE_TOO_LARGE: 'That image is larger than the 5 MB limit.',
  PROFILE_IMAGE_INVALID: 'That file couldn’t be processed. Use a JPEG, PNG or WebP image.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};

// Superset copy for the whole avatar pipeline (request → PUT → commit → activate). Covers the commit +
// update codes plus the client-only UPLOAD_FAILED (the direct Supabase PUT failed — never expose a URL).
export const AVATAR_PIPELINE_MESSAGES: Record<AvatarPipelineErrorCode, string> = {
  ...AVATAR_COMMIT_MESSAGES,
  ...PROFILE_UPDATE_MESSAGES,
  UPLOAD_FAILED: 'Your photo couldn’t be uploaded. Please try again.',
};

// Terminal, non-error avatar states (the state machine's timedOut/failed nodes) get their own copy.
export const AVATAR_TIMED_OUT_MESSAGE =
  'This is taking longer than expected. Your photo may still be processing.';
export const AVATAR_FAILED_MESSAGE = 'We couldn’t process that photo. Please try another image.';

// Per-field 422 copy, keyed by the backend's dotted `field` path. The backend string is used ONLY to pick
// the field; this map supplies the shown text. A field with no entry falls back to a generic message.
export const PROFILE_FIELD_MESSAGES: Record<string, string> = {
  bio: 'Your bio is too long (max 300 characters).',
  statement: 'Your statement is too long (max 500 characters).',
  'socialLinks.twitter': 'Enter a valid X (Twitter) handle or profile URL.',
  'socialLinks.instagram': 'Enter a valid Instagram handle or profile URL.',
  'socialLinks.website': 'Enter a valid https website URL.',
  profileImageId: 'That photo could not be used. Please upload it again.',
};

export const PROFILE_FIELD_FALLBACK_MESSAGE = 'This field is invalid.';
