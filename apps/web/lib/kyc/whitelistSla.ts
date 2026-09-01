import { WHITELIST_SLA_BUSINESS_DAYS } from '@/lib/kyc/constants';

// Deterministic date helpers for the whitelist card (TOV-45 / FR-01.08). Pure + framework-free so the
// server render and the client poll produce byte-identical output — no SSR↔client hydration mismatch. All
// arithmetic and formatting is in UTC for the same reason: a locale/timezone-relative date can differ
// between server and browser and flip the rendered day.

// Add `n` business days (skipping Sat/Sun; public holidays are ignored — out of scope) to an ISO
// timestamp, in UTC. Returns null for a missing/unparseable input so callers render nothing rather than
// "Invalid Date". Does not mutate the caller's input.
export function addBusinessDays(iso: string | null | undefined, n: number): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  let added = 0;
  while (added < n) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added += 1; // skip Sunday (0) / Saturday (6)
  }
  return date;
}

// pending_review estimated decision date = last_submission_at + the SLA window. Null when the source
// timestamp is missing/invalid → the card shows plain "Pending review" with no date line.
export function estimatedDecisionDate(lastSubmissionAt: string | null | undefined): Date | null {
  return addBusinessDays(lastSubmissionAt, WHITELIST_SLA_BUSINESS_DAYS);
}

// Fixed-locale/UTC format (e.g. "17 Jul 2026"). Identical on server + client. Null for bad input. Delegates to
// the shared formatter (#211) — kept as a named re-export so existing whitelist call sites are unchanged.
export { formatUtcDate as formatWhitelistDate } from '@/lib/format/date';

// Is the estimate already in the past relative to an explicit `nowMs`? Caller passes now (kept pure for
// tests + to keep the SSR render deterministic — the card only supplies a real clock after mount).
export function isPastDue(date: Date | null, nowMs: number): boolean {
  return date !== null && date.getTime() < nowMs;
}
