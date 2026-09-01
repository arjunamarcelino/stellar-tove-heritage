import type { Holding } from '@/lib/types/api';

// Wire row exactly as GET /v1/me/holdings returns it (camelCase, i128-safe decimal-string amounts).
// Includes `artworkId`, which the service strips from the domain object.
export function makeWireRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artworkId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    artworkTitle: 'Sunrise over the Estuary',
    artworkSlug: 'sunrise-over-the-estuary-a1b2c3',
    artworkImageUrl:
      'https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/public/artworks/sunrise.jpg',
    tokenContract: 'CFRACTIONCONTRACT00000000000000000000000000000000000000',
    balance: '60',
    lockedBalance: '0',
    freeBalance: '60',
    artistHandle: '@monet',
    ...overrides,
  };
}

// Domain Holding (post-mapping): camelCase, no `artworkId`.
export function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    artworkTitle: 'Sunrise over the Estuary',
    artworkSlug: 'sunrise-over-the-estuary-a1b2c3',
    artworkImageUrl:
      'https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/public/artworks/sunrise.jpg',
    artistHandle: '@monet',
    tokenContract: 'CFRACTIONCONTRACT00000000000000000000000000000000000000',
    balance: '60',
    lockedBalance: '0',
    freeBalance: '60',
    ...overrides,
  };
}
