/**
 * An ISO-8601 timestamp string MUST carry an explicit UTC offset (`Z` or `±hh:mm`).
 *
 * `@IsISO8601({ strict: true, strictSeparator: true })` alone does NOT require an offset (verified gap): an
 * offset-less string like `"2026-08-25T12:00:00"` passes and is then parsed as server-local, drifting the
 * persisted instant, any comparison against it, and idempotency fingerprints. Pair this `@Matches()` with the
 * `@IsISO8601` decorator on every timestamp body field. Shared by the offerings and marketplace-quote DTOs.
 */
export const TZ_OFFSET_RE = /(?:Z|[+-]\d{2}:\d{2})$/;
