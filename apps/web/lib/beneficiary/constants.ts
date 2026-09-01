// Beneficiary-form tuning constants (TOV-46 / FR-01.10). Kept out of beneficiaryMessages.ts so that file
// stays copy-only (mirrors the lib/profile + lib/kyc constants/messages split).

// ── Request timeout ──────────────────────────────────
export const BENEFICIARY_TIMEOUT_MS = 10_000; // GET / POST / DELETE /v1/me/beneficiary

// ── Field limits (mirror the backend; counted in UTF-16 code units, so an emoji may count as 2) ──
export const NAME_MAX_LENGTH = 200;
export const EMAIL_MAX_LENGTH = 320; // backend authority (RFC-5322 local+domain max)
export const RELATIONSHIP_MAX_LENGTH = 64;
export const NOTES_MAX_LENGTH = 1000;

// Clamp untrusted `notes` when rendering the read-only summary so a 1000-char note can't break layout
// (defence-in-depth for third-party free text — the value is still React-escaped).
export const SUMMARY_NOTES_CLAMP = 280;
