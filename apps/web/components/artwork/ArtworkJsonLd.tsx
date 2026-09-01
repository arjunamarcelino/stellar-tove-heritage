import type { Artwork } from '@/lib/types/api';

// schema.org/VisualArtwork JSON-LD for rich search results (TOV-190). SSR-only. `image` uses ONLY the
// UNSIGNED primaryImageUrl — a 1h signed URL would rot in a crawler cache. Null fields are omitted from the
// graph.
//
// XSS-safe embed (Next json-ld guide): JSON.stringify does NOT neutralize a `</script>` breakout in a
// free-text field (title/medium/custodian), so escape `<` (closes the breakout) plus `>`/`&` as
// defense-in-depth before it reaches the DOM. Native <script> + dangerouslySetInnerHTML (never next/script).

function buildJsonLd(artwork: Artwork): Record<string, unknown> {
  const graph: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    name: artwork.title,
  };
  if (artwork.primaryImageUrl) graph.image = artwork.primaryImageUrl;
  if (artwork.artistName) graph.creator = { '@type': 'Person', name: artwork.artistName };
  if (artwork.medium) {
    graph.artform = artwork.medium;
    graph.artMedium = artwork.medium;
  }
  if (artwork.year !== null) graph.dateCreated = String(artwork.year);
  return graph;
}

function safeSerialize(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export default function ArtworkJsonLd({ artwork }: { artwork: Artwork }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeSerialize(buildJsonLd(artwork)) }}
    />
  );
}
