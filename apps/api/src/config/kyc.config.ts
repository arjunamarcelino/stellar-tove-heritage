import { registerAs } from '@nestjs/config';

/**
 * KYC submission + encrypted storage config (TOV-28, FR-01.07).
 *
 * - `bucket` — the PRIVATE Supabase bucket that holds the AES-256-GCM ciphertext blobs (ops-provisioned;
 *   the service assumes it exists). Distinct from the neutral `files` bucket.
 * - `masterKeyBase64` — the 32-byte KEK (base64). Wraps each per-document DEK (envelope encryption) and,
 *   via HKDF (`info='kyc-blob-hash'`), derives the keyed-`blob_hash` HMAC key — so there is ONE secret to
 *   provision/escrow/rotate, not two. Joi asserts it decodes to exactly 32 bytes (fail-fast at boot).
 * - `masterKeyVersion` — stamped onto every `kyc_documents.dek_key_version` so a future key rotation can
 *   re-wrap per row without re-encrypting blobs.
 * - `signedUrlTtl` — short TTL for the LATER document-read ticket (kept here so the contract is pinned now).
 * - `jurisdictionAllowlist` — ISO-3166-1 alpha-2 codes eligible to submit. A miss → 422
 *   `JURISDICTION_NOT_ELIGIBLE`. Joi asserts it is non-empty so a misconfig fails at boot rather than
 *   silently rejecting every collector.
 */
export const kycConfig = registerAs('kyc', () => ({
  // Required via Joi (no default) — the `?? ''` is a dead fallback kept only so the type is `string`;
  // a real boot always has this set (a missing bucket fails Joi validation at startup).
  bucket: process.env.KYC_STORAGE_BUCKET ?? '',
  masterKeyBase64: process.env.KYC_MASTER_KEY ?? '',
  masterKeyVersion: parseInt(process.env.KYC_MASTER_KEY_VERSION ?? '1', 10),
  signedUrlTtl: parseInt(process.env.KYC_SIGNED_URL_TTL ?? '90', 10),
  jurisdictionAllowlist: (process.env.KYC_JURISDICTION_ALLOWLIST ?? 'GB,US,SG')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  // Per-file size cap lives in one place: `KYC_MAX_FILE_BYTES` in kyc-file.validator.ts (also the Multer
  // interceptor limit). Not duplicated here.
  // Server-wide cap on simultaneous in-flight submissions (each buffers ~40MB) — bounds aggregate memory
  // since the per-user throttle does not. Excess requests get 503 (review #187).
  maxConcurrentSubmissions: parseInt(process.env.KYC_MAX_CONCURRENT_SUBMISSIONS ?? '4', 10),
  // Orphan-blob sweeper (review #193): a scheduled reconciliation that deletes bucket objects with no
  // `kyc_documents` row (crash-window leaks). Disabled in tests so no repeatable job is scheduled.
  sweepEnabled: (process.env.KYC_SWEEP_ENABLED ?? 'true') === 'true',
  sweepCron: process.env.KYC_SWEEP_CRON ?? '0 3 * * *', // daily 03:00
  orphanGraceHours: parseInt(process.env.KYC_ORPHAN_GRACE_HOURS ?? '48', 10), // don't touch fresh uploads
}));

export type KycConfig = ReturnType<typeof kycConfig>;
