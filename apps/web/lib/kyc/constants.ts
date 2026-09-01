import type { KycDocType } from '@/lib/types/api';

// KYC submission constants (TOV-34 / FR-01.07). Values verified against the backend (TOV-28 PR #30):
// per-file cap is 10 MB, accepted types are JPEG/PNG/PDF, jurisdiction is ISO-3166-1 alpha-2.

// Static jurisdiction allowlist — the single source of truth for eligible countries. The backend has NO
// read endpoint; the allowlist is a backend config env var (KYC_JURISDICTION_ALLOWLIST, default GB,US,SG)
// this constant mirrors, and a well-formed but off-allowlist pick is caught by the backend's 422
// JURISDICTION_NOT_ELIGIBLE backstop. `as const satisfies` preserves the literal codes/names while
// compile-checking the shape (mirrors WALLET_KINDS / KYC_DOC_TYPES).
export const KYC_ALLOWLIST = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'SG', name: 'Singapore' },
] as const satisfies readonly { code: string; name: string }[];

export type KycJurisdictionCode = (typeof KYC_ALLOWLIST)[number]['code'];

// Derived from KYC_ALLOWLIST (one list to edit). The cast preserves the non-empty literal tuple z.enum
// requires.
export const KYC_JURISDICTION_CODES = KYC_ALLOWLIST.map((j) => j.code) as [
  KycJurisdictionCode,
  ...KycJurisdictionCode[],
];

// 10 MB — matches the backend `maxFileBytes`. A looser client cap would let files through that the
// backend 422s (KYC_FILE_TOO_LARGE), so this is deliberately equal, not larger.
export const KYC_MAX_FILE_BYTES = 10 * 1024 * 1024;

// Accepted MIME types (the backend also magic-number sniffs; this is the client pre-flight).
export const KYC_ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

// The four documents in wire order. `satisfies` verifies every member is a real KycDocType (mirrors
// WALLET_KINDS) so "exactly these four, in order" is a compile-time fact.
export const KYC_DOC_TYPES = [
  'gov_id_front',
  'gov_id_back',
  'proof_of_address',
  'selfie',
] as const satisfies readonly KycDocType[];

// Per-slot UI config: label, hint, accept, and (selfie only) native front-camera capture. The selfie is
// images-only; ID docs + proof-of-address also allow PDF (all four are JPEG/PNG/PDF on the backend).
// Explicitly typed (not `as const`) so every element carries the OPTIONAL `capture` field — consumers
// read `d.capture` uniformly, which an `as const` union-of-literals (capture present on only one member)
// would reject.
export const KYC_DOCUMENTS: readonly {
  docType: KycDocType;
  label: string;
  hint: string;
  accept: string;
  capture?: 'user';
}[] = [
  {
    docType: 'gov_id_front',
    label: 'Government ID (front)',
    hint: 'JPEG, PNG or PDF · max 10 MB',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  {
    docType: 'gov_id_back',
    label: 'Government ID (back)',
    hint: 'JPEG, PNG or PDF · max 10 MB',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  {
    docType: 'proof_of_address',
    label: 'Proof of address',
    hint: 'JPEG, PNG or PDF · max 10 MB',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  {
    docType: 'selfie',
    label: 'Selfie',
    hint: 'JPEG or PNG · max 10 MB',
    accept: 'image/jpeg,image/png',
    capture: 'user',
  },
];

// Generous wall-clock deadline for the ~40 MB multipart submit: it covers upload transfer over a weak
// uplink, not just backend processing. Sized at 300 s to cover the ~320 s worst case (40 MB at ~1 Mbps)
// with headroom for backend time; a genuinely slower-than-1 Mbps user aborts to status 0 → NETWORK_ERROR
// and the retry replays the same idempotency key (duplicate-safe), so this is a ceiling, not a guarantee.
export const KYC_SUBMIT_TIMEOUT_MS = 300_000;

export const KYC_STATUS_TIMEOUT_MS = 10_000;

// Static SLA copy shown on the confirmation screen (the backend returns no SLA field).
export const KYC_SLA_COPY = 'We’ll review your documents within 1–2 business days.';

// localStorage key for the non-PII progress metadata (direction B — no blobs, no idempotency key).
export const KYC_PROGRESS_STORAGE_KEY = 'tove.kyc.progress';

// ── Whitelist status card (TOV-45 / FR-01.08) ─────────────
// Client poll cadence for the pending_review state. The Gherkin requires a live transition within 5 s; a
// 5 s tick meets it with one request per interval (polling stops the moment the status leaves pending).
export const WHITELIST_POLL_INTERVAL_MS = 5_000;

// Stop polling after this many CONSECUTIVE transport failures (network/server/429) so a backend outage
// can't spin an unbounded 5 s retry loop; the card keeps the last-known state and offers a manual retry.
export const WHITELIST_POLL_MAX_FAILURES = 5;

// Ceiling for the exponential backoff applied between consecutive failures (5s → 10s → 20s → 40s → …). A
// throttled/erroring endpoint (429/5xx) must not keep getting hit at the fixed 5 s cadence.
export const WHITELIST_POLL_BACKOFF_MAX_MS = 60_000;

// The card refreshes immediately when the tab is un-hidden — but not if it fetched within this window (incl.
// the SSR first paint), so rapid tab-toggling can't spray off-cadence requests at the endpoint.
export const WHITELIST_UNHIDE_DEBOUNCE_MS = 2_000;

// SLA window used to compute the pending_review "estimated decision date" from last_submission_at. The
// backend returns no SLA field; 2 business days mirrors the 1–2 day copy in KYC_SLA_COPY (upper bound).
export const WHITELIST_SLA_BUSINESS_DAYS = 2;
