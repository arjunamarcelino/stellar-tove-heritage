import { describe, it, expect } from 'vitest';
import { formatFractionCount, isZero, artworkHref, rfqHref } from '@/lib/holdings/format';

describe('formatFractionCount', () => {
  it('groups large integers without scientific notation', () => {
    expect(formatFractionCount('1000000')).toBe('1,000,000');
    expect(formatFractionCount('60')).toBe('60');
  });

  it('preserves precision beyond 2^53 (BigInt path)', () => {
    expect(formatFractionCount('9007199254740993')).toBe('9,007,199,254,740,993');
  });
});

describe('isZero', () => {
  it('detects zero and non-zero decimal strings', () => {
    expect(isZero('0')).toBe(true);
    expect(isZero('60')).toBe(false);
  });
});

describe('artworkHref / rfqHref', () => {
  it('encodes the artwork slug', () => {
    expect(artworkHref('sunrise-abc')).toBe('/a/sunrise-abc');
  });

  it('url-encodes both parts of the RFQ deep-link', () => {
    expect(rfqHref('C ABC&x', 'slug#1')).toBe('/rfq/new?token=C%20ABC%26x&artwork=slug%231');
  });
});
