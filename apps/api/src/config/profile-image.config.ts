import { registerAs } from '@nestjs/config';

/**
 * Profile-image config (TOV-30, FR-01.09). Domain-level knobs only — the domain service never injects
 * `supabaseConfig` (DIP). Most tuning (derivative sizes, webp quality, pixel/format limits, cron/grace)
 * lives in `profile-image.constants.ts`; only the genuinely per-environment values are env-configurable.
 *
 * - `sourceBucket` — PRIVATE bucket for the raw upload + private derivatives (**required**, no default: a
 *   missing/typo'd bucket must fail at boot, not silently bind an unintended one).
 * - `publicBucket` — public bucket that holds ONLY the active avatar's derivatives.
 * - `maxBytes` — server-side upload size cap (the bucket's `file_size_limit` is the first gate).
 * - `maintenanceEnabled` — the reconcile + reap repeatable jobs (disabled in tests so nothing is scheduled).
 * - `derivativeWorkerConcurrency` — worker fan-out, sized against memory (peak decode × concurrency).
 */
export const profileImageConfig = registerAs('profileImage', () => ({
  // Required via Joi (no default) — `?? ''` is a dead fallback kept only so the type is `string`.
  sourceBucket: process.env.PROFILE_IMAGE_SOURCE_BUCKET ?? '',
  publicBucket: process.env.PROFILE_IMAGE_PUBLIC_BUCKET ?? 'tove-public',
  maxBytes: parseInt(process.env.PROFILE_IMAGE_MAX_BYTES ?? '5242880', 10),
  maintenanceEnabled: (process.env.PROFILE_IMAGE_MAINTENANCE_ENABLED ?? 'true') === 'true',
  derivativeWorkerConcurrency: parseInt(process.env.PROFILE_DERIVATIVE_WORKER_CONCURRENCY ?? '2', 10),
}));

export type ProfileImageConfig = ReturnType<typeof profileImageConfig>;
