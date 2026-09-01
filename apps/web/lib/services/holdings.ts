import 'server-only';

import { z } from 'zod/v4';
import { getJson } from '@/lib/services/http';
import { HOLDINGS_MESSAGES } from '@/lib/holdings/holdingsMessages';
import { HOLDINGS_TIMEOUT_MS } from '@/lib/holdings/constants';
import type { Holding, HoldingsResult, HoldingsTransportErrorCode } from '@/lib/types/api';

// Read the collector's fraction holdings (backend TOV-237, GET /v1/me/holdings). Uses the shared http seam;
// no raw backend message ever reaches the UI — only the curated HOLDINGS_MESSAGES copy.

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// Decimal-integer string guard — amounts are i128-safe strings, validated as strings (never coerced through a
// lossy JS number).
const decimalString = z.string().regex(/^\d+$/);

// Empty-string / null → null, so `string | null` is a real invariant (an empty src would otherwise render a
// broken next/image). Keys are always present (nullable, not optional): a MISSING key is drift → SERVER_ERROR.
const nullableString = z
  .string()
  .transform((v) => v || null)
  .nullable();

// artworkImageUrl: keep only a valid https URL; a malformed/whitespace/non-https value normalizes to null so
// it deterministically becomes the placeholder tile instead of reaching next/image. (Thumbnails render
// `unoptimized`, so an off-allowlist host no longer throws at SSR — this keeps the `string | null` invariant
// honest regardless.) A MISSING key still fails (drift guard), same as nullableString.
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

// Wire row (camelCase, verified from the merged HoldingDto). Zod's default strip drops unknown keys (the
// fail-closed egress guard) — `artworkId` is on the wire but deliberately unlisted, so it's stripped and
// never reaches the domain object.
const holdingWireSchema = z.object({
  artworkTitle: z.string(),
  artworkSlug: z.string().regex(/^[a-z0-9-]+$/), // derived kebab+id; keeps the /a/{slug} link route-safe
  artworkImageUrl: imageUrlSchema,
  artistHandle: nullableString,
  tokenContract: z.string(),
  balance: decimalString,
  lockedBalance: decimalString,
  freeBalance: decimalString,
});

// Explicit, spread-free mapper — the single egress definition. The `: Holding` return annotation makes
// excess-property checking reject any stray field and fails to compile if `Holding` gains an unmapped field.
function toHolding(wire: z.infer<typeof holdingWireSchema>): Holding {
  return {
    artworkTitle: wire.artworkTitle,
    artworkSlug: wire.artworkSlug,
    artworkImageUrl: wire.artworkImageUrl,
    artistHandle: wire.artistHandle,
    tokenContract: wire.tokenContract,
    balance: wire.balance,
    lockedBalance: wire.lockedBalance,
    freeBalance: wire.freeBalance,
  };
}

// Status → transport-only fallback. Deliberately NOT the shared statusFallbackCode (its 404→WALLET_NOT_FOUND
// is nonsensical here and isn't a HoldingsTransportErrorCode). 503 HOLDINGS_UNAVAILABLE / 500 / 429 all fold
// into SERVER_ERROR.
function holdingsReadStatusFallback(status: number): HoldingsTransportErrorCode {
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 0) return 'NETWORK_ERROR';
  return 'SERVER_ERROR';
}

// Total — never throws (getJson swallows transport failures into status 0). Drives the "Your fractions"
// widget and the Sell-CTA gating.
export async function getHoldings(accessToken: string): Promise<HoldingsResult> {
  const outcome = await getJson('/v1/me/holdings', {
    timeoutMs: HOLDINGS_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (!outcome.ok) {
    const code = holdingsReadStatusFallback(outcome.status);
    return { status: 'error', code, message: HOLDINGS_MESSAGES[code] };
  }

  // The body must be a JSON array; a non-array (null/empty body/object) is a hard SERVER_ERROR — it can't be
  // a "collector holds nothing" (`[]`) nor a per-row drop, so failing closed here keeps empty unambiguous.
  if (!Array.isArray(outcome.data)) {
    return { status: 'error', code: 'SERVER_ERROR', message: HOLDINGS_MESSAGES.SERVER_ERROR };
  }

  // Per-row resilience: keep valid rows, count malformed ones. A single odd row (e.g. an unexpected slug)
  // must not hide the collector's entire portfolio — but `droppedCount` surfaces a notice in the widget so a
  // partial list is never silently rendered as complete (the data-integrity risk of a naive silent drop).
  const holdings: Holding[] = [];
  let droppedCount = 0;
  for (const row of outcome.data) {
    const parsed = holdingWireSchema.safeParse(row);
    if (parsed.success) holdings.push(toHolding(parsed.data));
    else droppedCount += 1;
  }

  return { status: 'success', holdings, droppedCount };
}
