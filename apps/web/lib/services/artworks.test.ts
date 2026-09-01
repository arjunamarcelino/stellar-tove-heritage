import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getArtwork } from '@/lib/services/artworks';
import { ARTWORK_ID, artworkWire, artwork, artworkWireNulls } from '@/test/fixtures/artworks';

const OLD_ENV = process.env;

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('getArtwork', () => {
  it('T1/T11: GETs the detail with NO Bearer header, cache:no-store, a timeout, and parses the wire shape', async () => {
    const fetchFn = stubFetch(200, artworkWire);
    const result = await getArtwork(ARTWORK_ID);
    expect(result).toEqual({ status: 'success', artwork });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/artworks/${ARTWORK_ID}`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBeUndefined(); // tokenless public read
    expect(init.cache).toBe('no-store');
    expect(init.next).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal); // ARTWORK_TIMEOUT_MS applied
  });

  it('T1: preserves supportingImages order', async () => {
    stubFetch(200, artworkWire);
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.supportingImages).toEqual(artworkWire.supportingImages);
  });

  it('T2: parses all-null nullable fields (year null, empty supporting, no COA)', async () => {
    stubFetch(200, artworkWireNulls);
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork).toMatchObject({
      title: 'Untitled',
      year: null,
      medium: null,
      dimensions: null,
      artistName: null,
      primaryImageUrl: null,
      supportingImages: [],
      coaSignedUrl: null,
      custodian: null,
      status: 'fractionalized',
    });
    expect(r.artwork).not.toHaveProperty('artistHandle'); // stripped, not mapped
  });

  it('T11/#191: empty AND whitespace-only text fields collapse to null; real values are trimmed', async () => {
    stubFetch(200, {
      ...artworkWire,
      medium: '', // empty
      artistName: '   ', // whitespace-only
      custodian: '  Tove Vault, Oslo  ', // padded real value
    });
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.medium).toBeNull();
    expect(r.artwork.artistName).toBeNull();
    expect(r.artwork.custodian).toBe('Tove Vault, Oslo');
  });

  it('T3: an empty supportingImages array stays an empty array', async () => {
    stubFetch(200, { ...artworkWire, supportingImages: [] });
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.supportingImages).toEqual([]);
  });

  it('T4: drops invalid supporting-image URLs (non-https / non-string), keeps valid in order', async () => {
    stubFetch(200, {
      ...artworkWire,
      supportingImages: [
        'https://signed.cdn.tove.test/img/ok-1.jpg?token=1',
        'http://insecure.tove.test/img/bad.jpg', // non-https → dropped
        'javascript:alert(1)', // scheme → dropped
        42, // non-string → dropped
        'https://signed.cdn.tove.test/img/ok-2.jpg?token=2',
      ],
    });
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.supportingImages).toEqual([
      'https://signed.cdn.tove.test/img/ok-1.jpg?token=1',
      'https://signed.cdn.tove.test/img/ok-2.jpg?token=2',
    ]);
  });

  it('#197: de-duplicates supporting images (preserving first-seen order)', async () => {
    const a = 'https://signed.cdn.tove.test/img/a.jpg?token=1';
    const b = 'https://signed.cdn.tove.test/img/b.jpg?token=2';
    stubFetch(200, { ...artworkWire, supportingImages: [a, b, a] });
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.supportingImages).toEqual([a, b]);
  });

  it('#197: caps supporting images at 24', async () => {
    const many = Array.from(
      { length: 40 },
      (_, i) => `https://signed.cdn.tove.test/img/${i}.jpg?token=${i}`,
    );
    stubFetch(200, { ...artworkWire, supportingImages: many });
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.supportingImages).toHaveLength(24);
    expect(r.artwork.supportingImages[0]).toBe(many[0]);
  });

  it('T4b: a missing / non-array supportingImages is drift → SERVER_ERROR', async () => {
    stubFetch(200, { ...artworkWire, supportingImages: 'not-an-array' });
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('T10: normalizes a javascript:/data: coaSignedUrl to null (hidden COA)', async () => {
    stubFetch(200, { ...artworkWire, coaSignedUrl: 'javascript:alert(document.cookie)' });
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.coaSignedUrl).toBeNull();
  });

  it('T11: normalizes a non-https primaryImageUrl to null', async () => {
    stubFetch(200, { ...artworkWire, primaryImageUrl: 'http://cdn.tove.test/aw.jpg' });
    const r = await getArtwork(ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.artwork.primaryImageUrl).toBeNull();
  });

  it('T5: SEC-1 rejects a non-uuid id → ARTWORK_NOT_FOUND without fetching', async () => {
    const fetchFn = stubFetch(200, artworkWire);
    expect(await getArtwork('not-a-uuid')).toEqual({ status: 'error', code: 'ARTWORK_NOT_FOUND' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [
      'errorCode body',
      { statusCode: 404, errorCode: 'ARTWORK_NOT_FOUND', message: 'Artwork not found' },
    ],
    ['codeless body', { statusCode: 404, error: 'Not Found' }],
  ])('T6: a 404 (%s) → ARTWORK_NOT_FOUND', async (_label, body) => {
    stubFetch(404, body);
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'ARTWORK_NOT_FOUND' });
  });

  it('T7: a 429 → RATE_LIMITED', async () => {
    stubFetch(429, { statusCode: 429, message: 'Too Many Requests' });
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'RATE_LIMITED' });
  });

  it('T8: a 500 → SERVER_ERROR', async () => {
    stubFetch(500, { statusCode: 500 });
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('T8: a transport failure (status 0, missing API_BASE_URL) → NETWORK_ERROR', async () => {
    delete process.env.API_BASE_URL;
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'NETWORK_ERROR' });
  });

  it('T9: an unknown status enum → SERVER_ERROR (fail-closed)', async () => {
    stubFetch(200, { ...artworkWire, status: 'draft' });
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('T9: an empty/whitespace title → SERVER_ERROR (fail-closed)', async () => {
    stubFetch(200, { ...artworkWire, title: '   ' });
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('#198: a non-uuid response id → SERVER_ERROR (fail-closed, no junk link)', async () => {
    stubFetch(200, { ...artworkWire, id: '../../etc/passwd' });
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('T9: a dropped required key (year missing) → SERVER_ERROR', async () => {
    const noYear: Record<string, unknown> = { ...artworkWire };
    delete noYear.year;
    stubFetch(200, noYear);
    expect(await getArtwork(ARTWORK_ID)).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });
});
