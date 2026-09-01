import type { Route } from 'next';

// Amounts arrive as i128-safe decimal-integer STRINGS (HoldingDto.balance is a decimal string). Format via
// BigInt so a value beyond 2^53 never loses precision (Intl.NumberFormat accepts BigInt). Inputs are
// schema-validated `/^\d+$/`, so BigInt() can't throw here.
export function formatFractionCount(value: string): string {
  return new Intl.NumberFormat('en-US').format(BigInt(value));
}

// Zero test for the Sell-CTA gate (the backend emits canonical "0", but BigInt is robust to any equivalent).
// Uses BigInt(0) rather than the `0n` literal — the tsconfig target predates ES2020 BigInt literals.
export function isZero(value: string): boolean {
  return BigInt(value) === BigInt(0);
}

// Browse-artworks index link. The `/artworks` route doesn't exist yet — same typedRoutes escape hatch.
// Centralized here with the other unshipped-route hrefs so they're removed together when the routes ship.
export function browseArtworksHref(): Route {
  return '/artworks' as unknown as Route;
}

// Artwork detail deep-link. The `/a/[slug]` route doesn't exist yet and typedRoutes rejects a computed
// string href, so the double cast is the sanctioned escape hatch until that route ships.
export function artworkHref(artworkSlug: string): Route {
  return `/a/${encodeURIComponent(artworkSlug)}` as unknown as Route;
}

// Sell RFQ deep-link. Both parts URL-encoded (a slug/contract with & # space would break the query string).
// Same typedRoutes escape hatch as artworkHref — `/rfq/new` ships in a later ticket.
export function rfqHref(tokenContract: string, artworkSlug: string): Route {
  return `/rfq/new?token=${encodeURIComponent(tokenContract)}&artwork=${encodeURIComponent(
    artworkSlug,
  )}` as unknown as Route;
}
