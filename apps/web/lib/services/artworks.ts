import 'server-only';

import { z } from 'zod/v4';
import { getJson, extractBackendCode } from '@/lib/services/http';
import type { Artwork, ArtworkStatus, ArtworkResult, ArtworkReadErrorCode } from '@/lib/types/api';

// The public artwork detail service (TOV-190 / FR-08.01). Backend contract TOV-189: anonymous, camelCase,
// `Cache-Control: no-store` (the body carries 1h SIGNED CDN URLs — images + COA — so it must never be
// route-cached; a stale body would serve dead links). NO raw backend message ever reaches the UI — the
// result union carries a `code` only. The page wraps this in React `cache()` so generateMetadata + the page
// render share ONE call (the getJson seam attaches a per-call AbortSignal that defeats raw fetch-memoization,
// and the detail endpoint is rate-limited 20/min).

// Read timeout — parity with OFFERING_TIMEOUT_MS / HOLDINGS_TIMEOUT_MS.
const ARTWORK_TIMEOUT_MS = 10_000;

// Upper bound on rendered supporting images — a fail-open cap so a backend regression returning a huge array
// can't render an unbounded grid of next/image tiles. Excess is silently dropped (consistent with per-item
// fail-open); a real gallery is far smaller.
const MAX_SUPPORTING_IMAGES = 24;

// SEC-1: every id crossing into a backend path is uuid-validated at the service boundary BEFORE the path is
// built (path-injection / SSRF guard). An invalid id rejects to not-found without a fetch.
const uuidSchema = z.uuid();

// Empty / whitespace-only / null → null so `string | null` is a real invariant (an empty field omits its row
// rather than rendering blank space, and stray padding on a real value is trimmed — matching `title`'s trim).
// Keys are always present (nullable, not optional): a MISSING key is drift → parse fails.
const nullableString = z
  .string()
  .transform((v) => v.trim() || null)
  .nullable();

// primaryImageUrl / coaSignedUrl: keep only a valid https URL; malformed/whitespace/non-https (incl. a
// `javascript:` / `data:` scheme) normalizes to null so it deterministically becomes "no image / no COA"
// instead of reaching next/image or an <a href> (offerings.ts / holdings.ts pattern).
const imageUrlSchema = z
  .string()
  .nullable()
  .transform((v) => {
    if (!v) return null;
    try {
      return new URL(v).protocol === 'https:' ? v : null;
    } catch {
      return null;
    }
  });

// Supporting images use a DIFFERENT schema from imageUrlSchema on purpose: here an invalid element must be
// DROPPED (fail-open), not turned into a null we'd filter anyway. So the wire field is `z.array(z.unknown())`
// (enforces array-ness only — a missing/non-array is drift → SERVER_ERROR; no element short-circuits the
// array), and each element is strict-parsed per-item in the mapper.
const httpsUrlSchema = z.string().refine((v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}, 'not an https url');

// Const-tuple source of truth for the visible artwork statuses — `satisfies` fails to compile if it drifts
// from ArtworkStatus, and z.enum rejects any other wire status at the parse boundary (a non-visible status is
// never returned on a 200 — the backend 404s it — so an unexpected value here is genuine drift).
const ARTWORK_STATUSES = ['verified', 'fractionalized'] as const satisfies readonly ArtworkStatus[];

const artworkWireSchema = z.object({
  // uuid (not just string): the response id is interpolated into the offering link href, so a malformed/hostile
  // backend id fails closed (→ SERVER_ERROR) rather than emitting a junk internal route.
  id: z.uuid(),
  title: z.string().trim().min(1), // guaranteed present + non-whitespace (drives <h1> + og:title)
  year: z.number().int().nullable(), // numeric on the wire (e.g. 1998), nullable
  medium: nullableString,
  dimensions: nullableString,
  artistName: nullableString,
  primaryImageUrl: imageUrlSchema,
  supportingImages: z.array(z.unknown()), // array-ness only; per-item strict-parsed in toArtwork
  coaSignedUrl: imageUrlSchema, // https-guarded; a non-https value → null → COA section hidden
  custodian: nullableString,
  status: z.enum(ARTWORK_STATUSES),
});

// Spread-free allow-list mapper — Zod's default strip already drops unknown keys (the fail-closed egress
// guard); the explicit `: Artwork` return annotation additionally rejects any stray field, so the file fails
// to compile if the domain type gains an unmapped one.
function toArtwork(wire: z.infer<typeof artworkWireSchema>): Artwork {
  // Per-item supporting-image parse: keep valid https URLs in order, dedup (they're React keys + shouldn't
  // render twice), and cap the count. Drop everything else. Fail-open mirrors the backend (a transiently-
  // unsignable image is silently omitted) — a bad element must not blank the page.
  const supportingImages: string[] = [];
  const seen = new Set<string>();
  for (const item of wire.supportingImages) {
    if (supportingImages.length >= MAX_SUPPORTING_IMAGES) break;
    const parsed = httpsUrlSchema.safeParse(item);
    if (parsed.success && !seen.has(parsed.data)) {
      seen.add(parsed.data);
      supportingImages.push(parsed.data);
    }
  }

  return {
    id: wire.id,
    title: wire.title,
    year: wire.year,
    medium: wire.medium,
    dimensions: wire.dimensions,
    artistName: wire.artistName,
    primaryImageUrl: wire.primaryImageUrl,
    supportingImages,
    coaSignedUrl: wire.coaSignedUrl,
    custodian: wire.custodian,
    status: wire.status,
  };
}

// Tokenless public read → can never be SESSION_EXPIRED. A codeless 404 defaults to ARTWORK_NOT_FOUND (its only
// 404 meaning); everything else folds to RATE_LIMITED / NETWORK_ERROR / SERVER_ERROR. Deliberately NOT the
// shared statusFallbackCode (its 404 → WALLET_NOT_FOUND isn't an ArtworkReadErrorCode).
function artworkReadStatusFallback(status: number): ArtworkReadErrorCode {
  if (status === 404) return 'ARTWORK_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 0) return 'NETWORK_ERROR';
  return 'SERVER_ERROR';
}

function mapArtworkReadError(status: number, data: unknown): ArtworkReadErrorCode {
  // Prefer an explicit ARTWORK_NOT_FOUND errorCode regardless of status; otherwise fall back on the status.
  return extractBackendCode(data) === 'ARTWORK_NOT_FOUND'
    ? 'ARTWORK_NOT_FOUND'
    : artworkReadStatusFallback(status);
}

// Public artwork detail read (tokenless, no-store). The page wraps this in React cache() for per-request dedup.
export async function getArtwork(id: string): Promise<ArtworkResult> {
  // SEC-1: invalid id → not-found without a fetch.
  if (!uuidSchema.safeParse(id).success) {
    return { status: 'error', code: 'ARTWORK_NOT_FOUND' };
  }

  const outcome = await getJson(`/v1/artworks/${id}`, {
    timeoutMs: ARTWORK_TIMEOUT_MS,
    // no-store: the body carries per-request 1h signed URLs; route-caching it would serve stale/dead links.
    // A short shared cache (≪ 1h) is safe (signed URLs are anonymous-public) but must live at the CDN
    // (s-maxage) — the root layout is `force-dynamic` (CSP nonce), so Next route ISR can't apply. See the
    // plan's D18 / Open Q1 (pending backend sign-off).
    cache: 'no-store',
  });

  if (!outcome.ok) {
    return { status: 'error', code: mapArtworkReadError(outcome.status, outcome.data) };
  }

  const parsed = artworkWireSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR' };
  }

  return { status: 'success', artwork: toArtwork(parsed.data) };
}
