/**
 * Pure handle validation for TOV-26 (FR-01.05). No I/O — shared by the write path (POST /me/handle,
 * throws 422) and the public availability check (GET /handles/check, returns a reason). Keeping these
 * rules here (not in the entity or a DTO) means the exact same format + reserved logic applies to both
 * surfaces, and the global ValidationPipe's 400 can't leak in place of the AC-mandated 422 codes.
 */

/** The single source of truth for the availability reason, shared by the service + check DTO. */
export type HandleReason = 'invalid_format' | 'reserved' | 'taken';

/** Handle length bounds — the single source so callers (e.g. the collectors read) don't re-hardcode 24. */
export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 24;

/**
 * Anchored, ASCII-only. Guarantees in one pass:
 *   • first char is a LETTER      → no leading digit, no leading separator
 *   • last char is alphanumeric    → no trailing separator
 *   • every separator is followed by an alphanumeric → no consecutive separators
 * Length is checked separately (the `*` quantifier is unbounded). ReDoS-safe: linear, the alternation
 * branches are disjoint on their first char and there is no nested quantifier.
 *
 * ASCII-only is load-bearing for the reserved check below: JS `toLowerCase()` (service) and Postgres
 * `lower()` (generated column) agree ONLY because non-ASCII is rejected here. If this is ever relaxed
 * to allow Unicode, revisit the reserved check + canonical equality (homoglyph/case-fold divergence).
 */
const HANDLE_RE = /^[A-Za-z]([A-Za-z0-9]|[._-][A-Za-z0-9])*$/;

/** True when `handle` is a structurally valid handle (charset + length + separator rules). */
export function isValidHandleFormat(handle: string): boolean {
  return handle.length >= MIN_HANDLE_LENGTH && handle.length <= MAX_HANDLE_LENGTH && HANDLE_RE.test(handle);
}

/**
 * Reserved handles, compared exact-canonical (lowercase) only — no substring/prefix match, so
 * `administrative` is NOT reserved. `as const` gives a literal tuple (free `ReservedHandle` union if
 * ever needed); widened to `ReadonlySet<string>` because `.has()` is called with an arbitrary string.
 * Words < 3 chars (e.g. `me`) are unreachable via the length rule but harmless in the set.
 */
const RESERVED_HANDLE_LIST = [
  'admin', 'administrator', 'root', 'superuser', 'staff', 'mod', 'moderator', 'official',
  'tove', 'toveheritage', 'api', 'app', 'www', 'mail', 'ftp', 'auth', 'login', 'logout',
  'register', 'signin', 'signup', 'me', 'you', 'user', 'users', 'handle', 'handles',
  'wallet', 'wallets', 'backoffice', 'dashboard', 'settings', 'config', 'system', 'support',
  'help', 'about', 'contact', 'null', 'undefined', 'none', 'true', 'false',
] as const;

export const RESERVED_HANDLES: ReadonlySet<string> = new Set(RESERVED_HANDLE_LIST);
