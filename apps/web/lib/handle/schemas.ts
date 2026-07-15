import { z } from 'zod/v4';

// Single source of truth for handle format (TOV-26 / FR-01.05), shared across the client hook, the
// commit action, and the service. Co-located here (not in the owning service) via the same
// shared-across-layers exception as lib/wallet/schemas.ts — the client hook can't import a
// `server-only` service, so a plain shared module is required.
//
// Rules: 3–24 chars; ASCII letters/digits/`_ - .`; first char a letter; last char a letter or digit;
// no consecutive separators; whitespace trimmed from the ends, internal whitespace invalid; CASING
// PRESERVED (do NOT lowercase — the display handle keeps the user's casing; the backend owns the
// lowercase canonical key). The reserved-word list is server-only — not replicated here.
//
// The anchored regex enforces first-char / last-char / no-doubled-separator in one pass. Length is a
// separate `.min`/`.max` (chained first) so a too-short/too-long value reads as a length error, not a
// charset error. `.trim()` runs before the checks so leading/trailing whitespace is stripped, while a
// value with INTERNAL whitespace fails the charset regex.
//
// PARITY (todo 104): these rules mirror the TOV-26 backend validator, confirmed against the backend
// contract (PR #28). The client is the stricter *format* gate; the reserved-word list is server-only.
// Drift fails safe either way — a client-green handle the backend rejects returns HANDLE_FORMAT_INVALID
// (mapped to curated copy), and a client-rejected handle simply never reaches the backend. If the
// backend validator changes, update this regex in lockstep.
export const handleSchema = z
  .string()
  .trim()
  .min(3, 'Handle must be at least 3 characters')
  .max(24, 'Handle must be 24 characters or fewer')
  .regex(
    /^[A-Za-z]([A-Za-z0-9]|[._-](?![._-]))*[A-Za-z0-9]$/,
    'Use letters, numbers, and single . _ or - (start with a letter)',
  );

export type Handle = z.infer<typeof handleSchema>;
