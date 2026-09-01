// Shared fixtures for the public artwork detail page (TOV-190 / FR-08.01). The wire shape is what the backend
// (TOV-189) returns; `artwork` is the mapped domain object. Downstream tests add LOCAL fixtures rather than
// editing this file.

import type { Artwork } from '@/lib/types/api';

export const ARTWORK_ID = '00000000-0000-4000-8000-0000000a0001';

// Wire shape (camelCase) as the backend returns it — services parse this. primaryImageUrl is an UNSIGNED
// passthrough CDN URL; supportingImages + coaSignedUrl are 1h SIGNED CDN URLs (distinct host, query token).
export const artworkWire = {
  id: ARTWORK_ID,
  title: 'Northern Lights',
  year: 1998,
  medium: 'Oil on canvas',
  dimensions: '80x120 cm',
  artistHandle: 'sophie-tove', // returned by the backend but intentionally not mapped (no artist route yet)
  artistName: 'Sophie Tove',
  primaryImageUrl: 'https://cdn.tove.test/aw-001.jpg',
  supportingImages: [
    'https://signed.cdn.tove.test/img/aw-001-a.jpg?token=abc',
    'https://signed.cdn.tove.test/img/aw-001-b.jpg?token=def',
  ],
  coaSignedUrl: 'https://signed.cdn.tove.test/coa/aw-001.pdf?token=ghi',
  custodian: 'Tove Vault, Oslo',
  status: 'verified',
} as const;

export const artwork: Artwork = {
  id: ARTWORK_ID,
  title: 'Northern Lights',
  year: 1998,
  medium: 'Oil on canvas',
  dimensions: '80x120 cm',
  artistName: 'Sophie Tove',
  primaryImageUrl: 'https://cdn.tove.test/aw-001.jpg',
  supportingImages: [
    'https://signed.cdn.tove.test/img/aw-001-a.jpg?token=abc',
    'https://signed.cdn.tove.test/img/aw-001-b.jpg?token=def',
  ],
  coaSignedUrl: 'https://signed.cdn.tove.test/coa/aw-001.pdf?token=ghi',
  custodian: 'Tove Vault, Oslo',
  status: 'verified',
};

// All optional fields null / empty (the "sparse" artwork) — every nullable key present-but-null, empty
// supporting list, no COA. Exercises the omit-the-row / hide-the-section render paths.
export const artworkWireNulls = {
  id: ARTWORK_ID,
  title: 'Untitled',
  year: null,
  medium: null,
  dimensions: null,
  artistHandle: null,
  artistName: null,
  primaryImageUrl: null,
  supportingImages: [],
  coaSignedUrl: null,
  custodian: null,
  status: 'fractionalized',
} as const;
