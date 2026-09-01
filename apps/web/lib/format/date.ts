// Deterministic fixed-locale/UTC date formatting, feature-neutral. A locale/timezone-relative format can flip
// the rendered day between the server and the browser → a hydration mismatch; pinning BOTH locale and timeZone
// makes the output byte-identical on both sides. Never use toLocale*; never reach for suppressHydrationWarning.
// Promoted so the whitelist card (TOV-45) and the provenance timeline (TOV-192) share one formatter (#211).

const UTC_DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

// "24 Aug 2026" for a valid instant; null for a missing/unparseable value so the caller renders nothing rather
// than "Invalid Date". Accepts an ISO string or a Date.
export function formatUtcDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return UTC_DAY_FORMAT.format(date);
}
