import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense, cache } from 'react';
import { z } from 'zod/v4';
import { SITE_CONFIG } from '@/lib/constants';
import { IMAGE_ORIGIN } from '@/lib/images';
import { getArtwork } from '@/lib/services/artworks';
import { getArtworkTimeline } from '@/lib/services/timeline';
import ArtworkImage from '@/components/artwork/ArtworkImage';
import ArtworkMetaPanel from '@/components/artwork/ArtworkMetaPanel';
import SupportingImageGrid from '@/components/artwork/SupportingImageGrid';
import ArtworkJsonLd from '@/components/artwork/ArtworkJsonLd';
import ArtworkDetailSkeleton from '@/components/artwork/ArtworkDetailSkeleton';
import ArtworkTimeline from '@/components/artwork/ArtworkTimeline';
import ArtworkTimelineSkeleton from '@/components/artwork/ArtworkTimelineSkeleton';

// Public artwork detail page (TOV-190 / FR-08.01). Anonymous SSR; renders fully without client JS. `params` is
// a Promise in Next 16 — awaited below.
type PageParams = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

// ONE backend read per request, shared by generateMetadata + the streamed section. React cache() is the
// dedup guarantee: the getJson seam attaches a per-call AbortSignal that defeats raw fetch-memoization, and
// the detail endpoint is rate-limited 20/min.
const loadArtwork = cache(getArtwork);

// Thrown here (not in the server-only service) on a transient/malformed read → app/error.tsx (which offers a
// reset + renders robots noindex). Static message — never interpolate backend detail. A genuine "not found"
// uses notFound() instead, so a transient blip never renders as "artwork doesn't exist".
export class ArtworkLoadError extends Error {
  constructor() {
    super('Failed to load artwork');
    this.name = 'ArtworkLoadError';
  }
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  // Guard BEFORE reflecting the id into title/canonical/og:url; invalid → generic site title, no throw.
  if (!idSchema.safeParse(id).success) return { title: SITE_CONFIG.name };

  const result = await loadArtwork(id);
  if (result.status === 'error') return { title: SITE_CONFIG.name };
  const { artwork } = result;

  const title = `${artwork.title} — ${SITE_CONFIG.name}`;
  const description = artwork.artistName
    ? `${artwork.title} by ${artwork.artistName}`
    : artwork.title;
  const canonical = `/artworks/${id}`;
  // Only the UNSIGNED primaryImageUrl may enter indexable head tags (signed URLs expire in ~1h and would rot
  // in scraper / Search Console caches).
  const image = artwork.primaryImageUrl;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: SITE_CONFIG.name,
      images: image ? [{ url: image, width: 1200, height: 630, alt: artwork.title }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

// Async section streamed inside the Suspense boundary. Exported for unit-testing the SSR branches (it never
// runs when the default page is called directly).
export async function ArtworkSection({ id }: { id: string }) {
  const result = await loadArtwork(id);
  if (result.status === 'error') {
    // A genuine not-found → the static 404; a transient read → app/error.tsx (distinct so a backend blip isn't
    // shown as "artwork doesn't exist").
    if (result.code === 'ARTWORK_NOT_FOUND') notFound();
    throw new ArtworkLoadError();
  }
  const { artwork } = result;
  const heroAlt = artwork.artistName ? `${artwork.title} by ${artwork.artistName}` : artwork.title;

  return (
    <article className="flex flex-col gap-[var(--spacing-section)]">
      <ArtworkJsonLd artwork={artwork} />
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-charcoal/5">
        <ArtworkImage
          url={artwork.primaryImageUrl}
          title={artwork.title}
          alt={heroAlt}
          variant="hero"
        />
      </div>
      <ArtworkMetaPanel artwork={artwork} />
      <SupportingImageGrid images={artwork.supportingImages} title={artwork.title} />
      {/* Own Suspense boundary: the timeline streams independently and NEVER throws to app/error.tsx — a
          timeline blip must not noindex/blank a valid artwork page (its failure hydrates as an inline error). */}
      <Suspense fallback={<ArtworkTimelineSkeleton />}>
        <TimelineSection id={artwork.id} />
      </Suspense>
    </article>
  );
}

// Streams the first timeline page (default view, limit 20) and hands it to the client component as `initial`.
// Returns a discriminated result — never throws — so an error hydrates straight into the client's inline error.
// Exported for unit-testing the SSR branch (parity with ArtworkSection).
// The default page-1 view is byte-identical for every anonymous viewer → cache it in Next's data cache
// (revalidate + per-artwork tag) so timeline traffic doesn't hammer the backend's shared 30/min rate limit.
// Client cursor/expand reads (via the Server Action) stay no-store. Revalidate-on-publish is a future webhook.
const TIMELINE_REVALIDATE_S = 300;

export async function TimelineSection({ id }: { id: string }) {
  const initial = await getArtworkTimeline(id, { limit: 20, revalidate: TIMELINE_REVALIDATE_S });
  return <ArtworkTimeline artworkId={id} initial={initial} />;
}

export default async function ArtworkDetailPage({ params }: PageParams) {
  const { id } = await params; // Next 16: params is a Promise
  if (!idSchema.safeParse(id).success) notFound(); // SEC-1: reject a malformed id before any fetch

  return (
    <section className="mx-auto w-full max-w-5xl px-[var(--spacing-gutter)] py-[var(--spacing-section)]">
      {/* Warm the image CDN TLS handshake in parallel with the backend fetch, before the hero URL is known. */}
      <link rel="preconnect" href={IMAGE_ORIGIN} />
      <link rel="dns-prefetch" href={IMAGE_ORIGIN} />
      <Suspense fallback={<ArtworkDetailSkeleton />}>
        <ArtworkSection id={id} />
      </Suspense>
    </section>
  );
}
