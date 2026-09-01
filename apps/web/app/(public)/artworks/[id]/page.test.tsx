import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { artwork, ARTWORK_ID } from '@/test/fixtures/artworks';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  getArtwork: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/services/artworks', () => ({ getArtwork: h.getArtwork }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
// Stub the section's children so we can inspect ArtworkSection's element tree without loading their
// transitive 'use client' → next/image chains.
vi.mock('@/components/artwork/ArtworkImage', () => ({ default: () => null }));
vi.mock('@/components/artwork/ArtworkMetaPanel', () => ({ default: () => null }));
vi.mock('@/components/artwork/SupportingImageGrid', () => ({ default: () => null }));
vi.mock('@/components/artwork/ArtworkJsonLd', () => ({ default: () => null }));

import ArtworkDetailPage, {
  ArtworkSection,
  ArtworkLoadError,
  generateMetadata,
} from '@/app/(public)/artworks/[id]/page';
import ArtworkMetaPanel from '@/components/artwork/ArtworkMetaPanel';
import SupportingImageGrid from '@/components/artwork/SupportingImageGrid';
import ArtworkJsonLd from '@/components/artwork/ArtworkJsonLd';

// Recursively find the first element of a given component type in a returned RSC tree.
function findByType(node: unknown, type: unknown): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as ReactElement;
  if (el.type === type) return el;
  const children = (el.props as { children?: unknown } | undefined)?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findByType(child, type);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getArtwork.mockResolvedValue({ status: 'success', artwork });
});

describe('ArtworkSection', () => {
  it('T13: calls notFound() when the artwork is not found', async () => {
    h.getArtwork.mockResolvedValue({ status: 'error', code: 'ARTWORK_NOT_FOUND' });
    await expect(ArtworkSection({ id: ARTWORK_ID })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.notFound).toHaveBeenCalled();
  });

  it.each([['SERVER_ERROR'], ['RATE_LIMITED'], ['NETWORK_ERROR']])(
    'T14: throws ArtworkLoadError on a transient read (%s) — never notFound()',
    async (code) => {
      h.getArtwork.mockResolvedValue({ status: 'error', code });
      await expect(ArtworkSection({ id: ARTWORK_ID })).rejects.toBeInstanceOf(ArtworkLoadError);
      expect(h.notFound).not.toHaveBeenCalled();
    },
  );

  it('T16/T17: renders the meta panel, supporting grid, and JSON-LD with the artwork', async () => {
    const tree = await ArtworkSection({ id: ARTWORK_ID });
    const meta = findByType(tree, ArtworkMetaPanel);
    const grid = findByType(tree, SupportingImageGrid);
    const jsonLd = findByType(tree, ArtworkJsonLd);
    expect((meta?.props as { artwork: unknown }).artwork).toEqual(artwork);
    expect((grid?.props as { images: unknown }).images).toEqual(artwork.supportingImages);
    expect((jsonLd?.props as { artwork: unknown }).artwork).toEqual(artwork);
  });
});

describe('ArtworkDetailPage (default export)', () => {
  it('#200: rejects a malformed uuid via notFound() before rendering the section', async () => {
    await expect(
      ArtworkDetailPage({ params: Promise.resolve({ id: 'not-a-uuid' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.notFound).toHaveBeenCalled();
    expect(h.getArtwork).not.toHaveBeenCalled(); // no fetch on a bad id
  });

  it('#200: a valid uuid returns the shell (with preconnect) without calling notFound', async () => {
    const tree = await ArtworkDetailPage({ params: Promise.resolve({ id: ARTWORK_ID }) });
    expect(tree).toBeTruthy();
    expect(h.notFound).not.toHaveBeenCalled();
    // The section (and its fetch) live inside Suspense — not invoked during the shell render.
    expect(h.getArtwork).not.toHaveBeenCalled();
  });
});

describe('generateMetadata', () => {
  it('T22: builds title, canonical, OG image (unsigned) and a large twitter card', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: ARTWORK_ID }) });
    expect(meta.title).toBe('Northern Lights — Tove Heritage');
    expect(meta.alternates?.canonical).toBe(`/artworks/${ARTWORK_ID}`);
    expect(meta.openGraph?.images).toEqual([
      { url: artwork.primaryImageUrl, width: 1200, height: 630, alt: 'Northern Lights' },
    ]);
    expect((meta.twitter as { card?: string }).card).toBe('summary_large_image');
    // No signed/supporting URL ever appears in indexable metadata.
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain('signed.cdn.tove.test');
  });

  it('T22: null primaryImageUrl → no og:image, twitter downgrades to summary', async () => {
    h.getArtwork.mockResolvedValue({
      status: 'success',
      artwork: { ...artwork, primaryImageUrl: null },
    });
    const meta = await generateMetadata({ params: Promise.resolve({ id: ARTWORK_ID }) });
    expect(meta.openGraph?.images).toBeUndefined();
    expect((meta.twitter as { card?: string }).card).toBe('summary');
  });

  it('T23: an invalid uuid param → generic site title, no fetch, no canonical', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(meta.title).toBe('Tove Heritage');
    expect(meta.alternates).toBeUndefined();
    expect(h.getArtwork).not.toHaveBeenCalled();
  });

  it('T23: a read failure → generic site title, no throw', async () => {
    h.getArtwork.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR' });
    const meta = await generateMetadata({ params: Promise.resolve({ id: ARTWORK_ID }) });
    expect(meta.title).toBe('Tove Heritage');
  });
});
