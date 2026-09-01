import type { JobsOptions } from 'bullmq';

/**
 * Profile-image domain constants (TOV-30, FR-01.09). Single source of truth for the status vocabulary,
 * derivative sizes, storage paths, DI tokens, and BullMQ queue wiring — imported by the entity, service,
 * worker, and maintenance jobs so none of them drift.
 */

// Status vocabulary — a const tuple + derived union (house convention: varchar+CHECK, never a native enum).
// The DB CHECK on profile_images.status mirrors this list exactly.
export const PROFILE_IMAGE_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type ProfileImageStatus = (typeof PROFILE_IMAGE_STATUSES)[number];

// Derivative sizes. Keys are the ProfileImageDerivatives fields; values are the square edge in px.
export interface ProfileImageDerivatives {
  thumb?: string;
  card?: string;
  hero?: string;
}
export const PROFILE_DERIVATIVE_SPECS = [
  ['thumb', 64],
  ['card', 256],
  ['hero', 512],
] as const satisfies ReadonlyArray<readonly [keyof ProfileImageDerivatives, number]>;

// Accepted upload formats (validated against libvips' DETECTED format at commit, never the client MIME).
const PROFILE_IMAGE_ALLOWED_FORMATS = ['jpeg', 'png', 'webp'] as const;
export type ProfileImageFormat = (typeof PROFILE_IMAGE_ALLOWED_FORMATS)[number];
export const PROFILE_IMAGE_FORMAT_SET: ReadonlySet<string> = new Set(PROFILE_IMAGE_ALLOWED_FORMATS);

// sharp hardening + output tuning (constants, not env — never varied per environment).
export const PROFILE_WEBP_QUALITY = 82;
export const PROFILE_LIMIT_INPUT_PIXELS = 24_000_000; // ~24MP decompression-bomb ceiling
export const PROFILE_MAX_DIMENSION = 8000;

/** Shared sharp decode hardening — used by BOTH the commit probe and the worker so they can't drift. */
export const PROFILE_SHARP_INPUT_OPTS = {
  failOn: 'error',
  limitInputPixels: PROFILE_LIMIT_INPUT_PIXELS,
  animated: false,
} as const;

// Storage DI tokens (two SupabaseStorageService bindings: private source bucket, public derivatives bucket).
export const PROFILE_SOURCE_STORAGE = 'PROFILE_SOURCE_STORAGE';
export const PROFILE_PUBLIC_STORAGE = 'PROFILE_PUBLIC_STORAGE';

// Derivative worker queue.
export const PROFILE_DERIVATIVE_QUEUE = 'profile-image-derivatives';
export const PROFILE_DERIVE_JOB = 'derive';
export interface ProfileDeriveJob {
  profileImageId: string;
}
export const PROFILE_DERIVE_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

// Maintenance (reconcile stuck-processing + reap abandoned rows/blobs) queue.
export const PROFILE_MAINTENANCE_QUEUE = 'profile-image-maintenance';
export const PROFILE_RECONCILE_JOB = 'reconcile';
export const PROFILE_REAP_JOB = 'reap';
export const PROFILE_MAINTENANCE_CRON = '*/10 * * * *';
export const PROFILE_ORPHAN_GRACE_HOURS = 24;
export const PROFILE_PROCESSING_STUCK_MINUTES = 10; // re-drive threshold
export const PROFILE_PROCESSING_FAIL_MINUTES = 60; // hard-fail threshold (stuck beyond retries)

// Per-user ceiling on non-terminal (pending/processing) rows — bounds upload-mint abuse.
export const PROFILE_MAX_INFLIGHT_IMAGES = 5;

// Global (per-process) ceiling on concurrent commits — bounds aggregate download + sharp-decode load in the
// request path so a coordinated multi-account burst can't saturate the libuv threadpool. Excess → 503.
export const PROFILE_COMMIT_MAX_CONCURRENCY = Number(process.env.PROFILE_COMMIT_MAX_CONCURRENCY ?? '8');

/** Stable derivative job id (dedups the initial enqueue). BullMQ forbids ':' in custom ids — use '-'. */
export function profileDeriveJobId(imageId: string): string {
  return `derive-${imageId}`;
}
/** Unique re-drive job id (reconcile) — a fresh id per attempt so a retained failed job can't dedup it. */
export function profileDeriveRedriveJobId(imageId: string, attemptMs: number): string {
  return `derive-${imageId}-${attemptMs}`;
}

/** Private source-object key: `src/{userId}/{imageId}.orig`. */
export function profileSourcePath(userId: string, imageId: string): string {
  return `src/${userId}/${imageId}.orig`;
}
/** Private derivative key: `deriv/{imageId}/{size}.webp` (worker output, retained for re-activation). */
export function profilePrivateDerivativePath(imageId: string, size: number): string {
  return `deriv/${imageId}/${size}.webp`;
}
/** Public derivative key: `profile/{imageId}/{size}.webp` — no userId (never leaks the internal user id). */
export function profilePublicDerivativePath(imageId: string, size: number): string {
  return `profile/${imageId}/${size}.webp`;
}
