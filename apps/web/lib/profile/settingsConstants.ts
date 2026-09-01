// Profile-settings tuning constants (TOV-35 / FR-01.09). Kept out of profileSettingsMessages.ts so that
// file stays copy-only (mirrors the lib/kyc + lib/accept constants/messages split).

// ── Request timeouts ─────────────────────────────────
export const PROFILE_TIMEOUT_MS = 10_000; // GET /me + PATCH /me
export const AVATAR_REQUEST_TIMEOUT_MS = 10_000; // POST /me/profile-image + commit
// A hung status poll must fail fast so the next tick still fits inside the ~30s processing budget — a
// short, dedicated timeout (≈3 poll intervals), NOT the general 10s read timeout.
export const AVATAR_STATUS_TIMEOUT_MS = 5_000;
// The direct browser→Supabase PUT transfers up to 5 MB, so it needs a transfer-sized budget (not just
// backend-processing time). Wired to an AbortController so a new file pick / unmount can cancel it.
export const STORAGE_PUT_TIMEOUT_MS = 60_000;

// ── Avatar derivative poll (useAvatarUpload) ─────────
// Backend webp derivation of a ≤5 MB image is usually a second or two; poll at a flat base cadence with a
// ~30s ceiling (shorter than the whitelist review poll — a bounded image-resize job, not human review).
export const AVATAR_POLL_INTERVAL_MS = 1_500;
export const AVATAR_POLL_MAX_ATTEMPTS = 20; // ~30s of successful `processing` ticks → timedOut
// Exponential backoff between CONSECUTIVE transport failures (429/5xx/network) so a flapping backend isn't
// re-hit at 1.5s: 1.5s → 3s → 6s, capped. Distinct from the success cadence above. No jitter — this is a
// per-user poll of the user's own image, so there's no thundering-herd to de-sync (unlike settlement).
export const AVATAR_POLL_MAX_FAILURES = 4; // consecutive transport failures → timedOut
export const AVATAR_POLL_BACKOFF_MAX_MS = 8_000;

// ── Field limits (mirror the backend; counted in UTF-16 code units, so an emoji may count as 2) ──
export const BIO_MAX_LENGTH = 300;
export const STATEMENT_MAX_LENGTH = 500;

// ── Avatar image pre-flight (client gate; the backend re-validates at commit) ──
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const PROFILE_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const; // SVG excluded on purpose
// Reject an absurdly-large decoded image before it OOMs a low-RAM tab (decompression-bomb guard). A 512px
// hero derivative needs nothing near this; ~40 MP is a generous ceiling for a real phone photo.
export const PROFILE_IMAGE_MAX_PIXELS = 40_000_000;
