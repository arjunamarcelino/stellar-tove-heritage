import 'server-only';

import { z } from 'zod/v4';
import { getJson, extractBackendCode } from '@/lib/services/http';
import type {
  TimelineResult,
  TimelineEvent,
  TimelineReadErrorCode,
  TimelineVisibilityTier,
  Stroops,
  PositiveIntString,
  SecondaryTradeMeta,
  FractionalizationMeta,
} from '@/lib/types/api';

// Public artwork provenance timeline service (TOV-192 / FR-08.02+08.03). Backend contract TOV-191: anonymous,
// camelCase, cursor-paginated, `Cache-Control: no-store`, rate-limited 30/min. NO raw backend message reaches
// the UI — the result union carries a `code` only. Mirrors lib/services/artworks.ts (uuid guard → getJson →
// fail-closed envelope / fail-open items → local error map). ⚠️ TOV-191 is PLANNED: built behind the fail-open
// parser so additive contract drift can't blank the timeline (breaking drift still surfaces as SERVER_ERROR).

const TIMELINE_TIMEOUT_MS = 10_000; // parity with ARTWORK_TIMEOUT_MS
const DEFAULT_LIMIT = 20; // contract default
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
// Defense-in-depth cap so a backend regression returning a huge page can't build an unbounded DOM. The
// request-side `limit` clamp already bounds this; the mapper break is belt-and-suspenders, not correctness.
const MAX_EVENTS_PER_PAGE = 50;
// The cursor is opaque; we forward it verbatim but cap its length so a hostile oversized value fails closed
// before hitting the wire (the backend also validates → TIMELINE_INVALID_CURSOR). Exported so the Server Action
// guards with the SAME bound — one source of truth (#210).
export const MAX_CURSOR_LEN = 512;

// SEC-1: every id crossing into a backend path is uuid-validated at the boundary BEFORE the path is built
// (path-injection / SSRF guard). An invalid id rejects to not-found without a fetch.
const uuidSchema = z.uuid();

// occurredAt / settledAt feed Intl.DateTimeFormat at render, which THROWS on an unparseable Date — so guard
// PARSEABILITY, not just ISO shape (z.string().datetime() is shape-only). Mirrors lib/services/quotes.ts.
const isoDatetime = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
  message: 'invalid datetime',
});

// A canonical POSITIVE integer string (no leading zeros) — the stroop/count guard, matching quotes.ts. A
// branded Stroops is minted ONLY past this parse; a "0"/"01"/malformed value fails its per-type metadata parse
// and the event degrades to the generic card (never a value that throws later inside formatUsdc).
const positiveIntString = z.string().regex(/^[1-9]\d*$/);

// CLOSED contract — const-tuple `satisfies` fails to compile if it drifts from TimelineVisibilityTier, and
// z.enum drops an unrecognized tier at parse (genuine drift; no bucket to render it in).
const VISIBILITY_TIERS = [
  'default',
  'expanded',
] as const satisfies readonly TimelineVisibilityTier[];

// Per-type public-safe metadata sub-schemas. A parse failure here degrades the event to the generic card
// (kept, not dropped) — see toEvent. secondary_trade carries NO txHash (locked payload decision).
const fractionalizationMetaSchema = z.object({
  tokenAddress: z.string().trim().min(1),
  deployLedger: z.number().int(),
  txHash: z.string().trim().min(1),
});
const secondaryTradeMetaSchema = z.object({
  fractionCount: positiveIntString,
  pricePerFractionStroops: positiveIntString,
  settledAt: isoDatetime,
});

const eventWireSchema = z.object({
  id: z.uuid(), // stable React key; a non-uuid id is drift → the item drops (fail-open)
  // OPEN on purpose: an unknown backend type must render generic, not drop. The card switch owns known-vs-generic.
  eventType: z.string().min(1),
  visibilityTier: z.enum(VISIBILITY_TIERS),
  occurredAt: isoDatetime, // parseable; the DESC sort key (server-ordered — never re-sorted client-side)
  // Fail-open on summary: absent/null/empty/whitespace all normalize to null so a metadata-only event (no
  // summary) still renders (type + date) rather than being dropped. See Open Q6 — flip to a stricter
  // present-but-null rule if TOV-191 guarantees the key is always present.
  summary: z
    .string()
    .nullish()
    .transform((s) => {
      const trimmed = (s ?? '').trim();
      return trimmed.length ? trimmed : null;
    }),
  // A non-object / null metadata degrades to {} so the event still renders generic (never blanks the row).
  metadata: z.record(z.string(), z.unknown()).catch({}),
});

// Fail-CLOSED on STRUCTURE (events must be an array, nextCursor must be string|null), but the non-load-bearing
// count DEGRADES rather than blanking a page full of valid provenance.
const envelopeWireSchema = z.object({
  events: z.array(z.unknown()), // array-ness only; per-item strict-parsed in the mapper
  additionalEventsCount: z.number().int().min(0).catch(0),
  // Opaque continuation token; forwarded verbatim, never decoded. `.nullish()` tolerates an OMITTED key as
  // "last page" (a common REST shape) so it reads as null rather than fail-closing the whole envelope (#206) —
  // matching the `summary` tolerance. A wrong TYPE (e.g. a number) still fails structurally.
  nextCursor: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

// Per-type metadata parse. The mapper is the single enforcer of the invariant "a LIVE eventType ⟹ valid
// branded metadata" that the card's Extract type-guard relies on:
//   • live type + valid metadata  → typed arm (allowlisted fields only; `as Stroops` minted past positiveIntString)
//   • live type + INVALID metadata → **drop** (return null → caller increments droppedCount). Keeping it with the
//     live eventType would let the card re-enter the typed branch over unvalidated data and throw in render
//     (formatUsdc/truncateMiddle) → escape Suspense → noindex the page (todo #202).
//   • generic / unknown type       → generic arm with metadata STRIPPED to {} (the card never renders generic
//     metadata; shipping raw wire.metadata is pure egress risk — e.g. a stray txHash — so it is not forwarded).
function toEvent(wire: z.infer<typeof eventWireSchema>): TimelineEvent | null {
  const base = {
    id: wire.id,
    visibilityTier: wire.visibilityTier,
    occurredAt: wire.occurredAt,
    summary: wire.summary,
  };

  if (wire.eventType === 'fractionalization') {
    const parsed = fractionalizationMetaSchema.safeParse(wire.metadata);
    if (!parsed.success) return null; // drop; do NOT emit a typed arm over invalid metadata
    const metadata: FractionalizationMeta = {
      tokenAddress: parsed.data.tokenAddress,
      deployLedger: parsed.data.deployLedger,
      txHash: parsed.data.txHash,
    };
    return { ...base, eventType: 'fractionalization', metadata };
  }

  if (wire.eventType === 'secondary_trade') {
    const parsed = secondaryTradeMetaSchema.safeParse(wire.metadata);
    if (!parsed.success) return null; // drop
    const metadata: SecondaryTradeMeta = {
      fractionCount: parsed.data.fractionCount as PositiveIntString,
      pricePerFractionStroops: parsed.data.pricePerFractionStroops as Stroops,
      settledAt: parsed.data.settledAt,
    };
    return { ...base, eventType: 'secondary_trade', metadata };
  }

  // Generic arm: the 7 known-future types + any unknown type. Metadata stripped (never rendered → never egressed).
  return { ...base, eventType: wire.eventType, metadata: {} };
}

function toTimeline(wire: z.infer<typeof envelopeWireSchema>): {
  events: TimelineEvent[];
  nextCursor: string | null;
  additionalEventsCount: number;
  droppedCount: number;
} {
  const events: TimelineEvent[] = [];
  let droppedCount = 0;
  for (const row of wire.events) {
    if (events.length >= MAX_EVENTS_PER_PAGE) break; // defense-in-depth (request limit already clamps)
    const parsed = eventWireSchema.safeParse(row);
    // Fail-open per item: a bad row (structural) OR a live type with invalid metadata (toEvent → null) is
    // dropped and counted — never blanks the page, and a degraded event can't reach a throwing card branch.
    const event = parsed.success ? toEvent(parsed.data) : null;
    if (event) events.push(event);
    else droppedCount += 1; // surfaced as a non-blocking notice
  }
  return {
    events,
    nextCursor: wire.nextCursor,
    additionalEventsCount: wire.additionalEventsCount,
    droppedCount,
  };
}

// Tokenless public read → never SESSION_EXPIRED. Prefer an explicit backend errorCode; otherwise fold status.
// Deliberately NOT the shared statusFallbackCode (its 404 → WALLET_NOT_FOUND isn't a TimelineReadErrorCode).
function timelineReadStatusFallback(status: number): TimelineReadErrorCode {
  if (status === 404) return 'ARTWORK_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 0) return 'NETWORK_ERROR';
  return 'SERVER_ERROR'; // incl. a generic 400 (validation) — our action pre-validates, so a 400 means drift
}

function mapTimelineReadError(status: number, data: unknown): TimelineReadErrorCode {
  const code = extractBackendCode(data);
  if (code === 'ARTWORK_NOT_FOUND') return 'ARTWORK_NOT_FOUND';
  if (code === 'TIMELINE_INVALID_CURSOR') return 'INVALID_CURSOR';
  return timelineReadStatusFallback(status);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));
}

// Fetch-cache tag for a per-artwork timeline — a future admin-publish webhook revalidates it (revalidateTag).
export function timelineTag(id: string): string {
  return `artwork-timeline:${id}`;
}

// `revalidate` opts the DEFAULT public page-1 view (no cursor, no expand) into Next's data cache — that body is
// byte-identical for every anonymous viewer, so caching it collapses backend load + protects the shared 30/min
// rate limit (the Next server IP is the caller). Cursor/expand reads are per-request and stay `no-store`.
export type TimelineQuery = {
  expand?: boolean;
  limit?: number;
  cursor?: string;
  revalidate?: number;
};

// Public timeline read (tokenless). Single per-request SSR call → no React cache() wrapper needed.
export async function getArtworkTimeline(
  id: string,
  opts: TimelineQuery = {},
): Promise<TimelineResult> {
  // SEC-1: invalid id → not-found without a fetch (identical to the artwork detail 404 — no existence oracle).
  if (!uuidSchema.safeParse(id).success) {
    return { status: 'error', code: 'ARTWORK_NOT_FOUND' };
  }

  // Opaque cursor — fail CLOSED on an over-length value (INVALID_CURSOR), matching the Server Action rather than
  // silently dropping it and returning page 1 (#210). Forwarded verbatim otherwise (never parsed/constructed).
  if (opts.cursor !== undefined && opts.cursor.length > MAX_CURSOR_LEN) {
    return { status: 'error', code: 'INVALID_CURSOR' };
  }

  const params = new URLSearchParams({ limit: String(clampLimit(opts.limit)) });
  if (opts.expand) params.set('expand', 'true');
  if (opts.cursor) params.set('cursor', opts.cursor);

  // Only the default page-1 view is cacheable; anything cursor/expand-scoped is per-request → no-store (#207).
  const cacheable = opts.revalidate !== undefined && !opts.cursor && !opts.expand;

  const outcome = await getJson(`/v1/artworks/${id}/timeline?${params.toString()}`, {
    timeoutMs: TIMELINE_TIMEOUT_MS,
    ...(cacheable
      ? { next: { revalidate: opts.revalidate, tags: ['artwork-timeline', timelineTag(id)] } }
      : { cache: 'no-store' }),
  });

  if (!outcome.ok) {
    return { status: 'error', code: mapTimelineReadError(outcome.status, outcome.data) };
  }

  const parsed = envelopeWireSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR' }; // fail-closed envelope
  }

  return { status: 'success', ...toTimeline(parsed.data) };
}
