import { describe, it, expect } from 'vitest';
import { artworkKeys } from './query-keys';

describe('artworkKeys', () => {
  it('builds hierarchical list/detail/fractionalization keys (positive)', () => {
    expect(artworkKeys.all).toEqual(['artworks']);
    expect(artworkKeys.lists()).toEqual(['artworks', 'list']);
    expect(artworkKeys.detail('abc')).toEqual(['artworks', 'detail', 'abc']);
    expect(artworkKeys.fractionalization('abc')).toEqual([
      'artworks',
      'fractionalization',
      'abc',
    ]);
  });

  it('encodes list params so different params yield different keys (edge)', () => {
    expect(artworkKeys.list({ page: 1 })).not.toEqual(artworkKeys.list({ page: 2 }));
    expect(artworkKeys.list({ status: 'verified' })).toEqual([
      'artworks',
      'list',
      { status: 'verified' },
    ]);
  });

  it('keeps fractionalization distinct from detail for the same id (negative)', () => {
    expect(artworkKeys.fractionalization('x')).not.toEqual(artworkKeys.detail('x'));
  });
});
