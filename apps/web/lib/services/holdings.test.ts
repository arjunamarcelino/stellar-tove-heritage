import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getHoldings } from '@/lib/services/holdings';
import { makeWireRow } from '@/test/fixtures/holdings';

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

describe('getHoldings', () => {
  it('GETs /v1/me/holdings with a Bearer header and maps the rows (camelCase, string amounts)', async () => {
    const fetchFn = stubFetch(200, [makeWireRow()]);
    const result = await getHoldings('tok');
    expect(result).toEqual({
      status: 'success',
      holdings: [
        {
          artworkTitle: 'Sunrise over the Estuary',
          artworkSlug: 'sunrise-over-the-estuary-a1b2c3',
          artworkImageUrl:
            'https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/public/artworks/sunrise.jpg',
          artistHandle: '@monet',
          tokenContract: 'CFRACTIONCONTRACT00000000000000000000000000000000000000',
          balance: '60',
          lockedBalance: '0',
          freeBalance: '60',
        },
      ],
      droppedCount: 0,
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/holdings');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns success with an empty list for [] (drives the empty state)', async () => {
    stubFetch(200, []);
    expect(await getHoldings('tok')).toEqual({ status: 'success', holdings: [], droppedCount: 0 });
  });

  it('strips unknown wire keys (egress guard) — no artworkId / wallet / user id leaks', async () => {
    stubFetch(200, [makeWireRow({ walletAddress: 'GWALLET', userId: 'u1' })]);
    const result = await getHoldings('tok');
    if (result.status !== 'success') throw new Error('expected success');
    expect(Object.keys(result.holdings[0]).sort()).toEqual([
      'artistHandle',
      'artworkImageUrl',
      'artworkSlug',
      'artworkTitle',
      'balance',
      'freeBalance',
      'lockedBalance',
      'tokenContract',
    ]);
    expect(result.holdings[0]).not.toHaveProperty('artworkId');
    expect(result.holdings[0]).not.toHaveProperty('walletAddress');
    expect(result.holdings[0]).not.toHaveProperty('userId');
  });

  it('normalizes empty image/handle to null', async () => {
    stubFetch(200, [makeWireRow({ artworkImageUrl: '', artistHandle: '' })]);
    const result = await getHoldings('tok');
    if (result.status !== 'success') throw new Error('expected success');
    expect(result.holdings[0].artworkImageUrl).toBeNull();
    expect(result.holdings[0].artistHandle).toBeNull();
  });

  it('normalizes a non-URL / non-https artworkImageUrl to null (placeholder path)', async () => {
    stubFetch(200, [makeWireRow({ artworkImageUrl: 'not a url' })]);
    let r = await getHoldings('tok');
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.holdings[0].artworkImageUrl).toBeNull();

    stubFetch(200, [makeWireRow({ artworkImageUrl: 'http://insecure.example/x.jpg' })]);
    r = await getHoldings('tok');
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.holdings[0].artworkImageUrl).toBeNull();
  });

  it('preserves a > 2^53 balance string exactly (no number coercion)', async () => {
    stubFetch(200, [makeWireRow({ balance: '9007199254740993', freeBalance: '9007199254740993' })]);
    const result = await getHoldings('tok');
    if (result.status !== 'success') throw new Error('expected success');
    expect(result.holdings[0].balance).toBe('9007199254740993');
  });

  it('drops malformed rows per-row, keeps valid ones, and reports droppedCount', async () => {
    // one bad (non-digit balance) + one good → the good row survives, dropped counts the bad one
    stubFetch(200, [makeWireRow({ balance: '6.5' }), makeWireRow({ tokenContract: 'CGOOD' })]);
    const r = await getHoldings('tok');
    expect(r).toMatchObject({ status: 'success', droppedCount: 1 });
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].tokenContract).toBe('CGOOD');

    // all rows malformed (bad slug, missing key) → success with no rows and droppedCount = 2 (never a
    // silent complete-looking empty; the widget shows a notice)
    const { freeBalance: _omit, ...noFree } = makeWireRow();
    void _omit;
    stubFetch(200, [makeWireRow({ artworkSlug: '../etc/passwd' }), noFree]);
    expect(await getHoldings('tok')).toMatchObject({ status: 'success', holdings: [], droppedCount: 2 });
  });

  it('fails closed (SERVER_ERROR) when the body is not an array', async () => {
    stubFetch(200, null);
    expect(await getHoldings('tok')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    stubFetch(200, { not: 'an array' });
    expect(await getHoldings('tok')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('maps 401→SESSION_EXPIRED, 503→SERVER_ERROR, and no-config→NETWORK_ERROR', async () => {
    stubFetch(401, {});
    expect(await getHoldings('tok')).toMatchObject({ status: 'error', code: 'SESSION_EXPIRED' });

    stubFetch(503, { errorCode: 'HOLDINGS_UNAVAILABLE' });
    expect(await getHoldings('tok')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });

    delete process.env.API_BASE_URL;
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await getHoldings('tok')).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('catches a thrown fetch and never propagates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getHoldings('tok')).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
  });
});
