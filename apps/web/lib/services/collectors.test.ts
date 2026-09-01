import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getCollectorByHandle } from '@/lib/services/collectors';

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

describe('getCollectorByHandle', () => {
  it('returns success with previousHandles (order preserved) and requests the right URL', async () => {
    const fetchFn = stubFetch(200, {
      handle: 'newname',
      previousHandles: ['earlyname'],
      createdAt: '2026-01-15',
    });
    const result = await getCollectorByHandle('newname');
    expect(result).toEqual({
      status: 'success',
      profile: { handle: 'newname', previousHandles: ['earlyname'] },
    });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.test/v1/collectors/newname');
    // the read timeout must be wired (todo 109) — dropping timeoutMs would leave the SSR read unbounded
    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('builds the request path from the handle (dots/dashes/underscores are URL-safe)', async () => {
    const fetchFn = stubFetch(200, { handle: 'a.b-c_d', previousHandles: [] });
    await getCollectorByHandle('a.b-c_d');
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.test/v1/collectors/a.b-c_d');
  });

  it('treats an empty array and an absent previousHandles key alike as empty history', async () => {
    stubFetch(200, { handle: 'newname', previousHandles: [] });
    expect(await getCollectorByHandle('newname')).toEqual({
      status: 'success',
      profile: { handle: 'newname', previousHandles: [] },
    });
    stubFetch(200, { handle: 'newname' });
    expect(await getCollectorByHandle('newname')).toEqual({
      status: 'success',
      profile: { handle: 'newname', previousHandles: [] },
    });
  });

  it('maps 404 to not_found', async () => {
    stubFetch(404, {});
    expect(await getCollectorByHandle('newname')).toEqual({ status: 'not_found' });
  });

  it('maps 5xx / 429 / 400 / 422 to error (only 404 means "no such profile")', async () => {
    for (const status of [500, 502, 503, 429, 400, 422]) {
      stubFetch(status, {});
      expect(await getCollectorByHandle('newname')).toEqual({ status: 'error' });
    }
  });

  it('maps a transport failure (status 0) to error', async () => {
    // missing API_BASE_URL → seam short-circuits to status 0
    process.env = { ...OLD_ENV };
    delete (process.env as Record<string, string | undefined>).API_BASE_URL;
    expect(await getCollectorByHandle('newname')).toEqual({ status: 'error' });

    // fetch rejects → seam catch → status 0
    process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await getCollectorByHandle('newname')).toEqual({ status: 'error' });
  });

  it('maps a schema-invalid 200 body to error', async () => {
    stubFetch(200, { previousHandles: ['x'] }); // missing handle
    expect(await getCollectorByHandle('newname')).toEqual({ status: 'error' });
    stubFetch(200, { handle: 'newname', previousHandles: 'nope' }); // not an array
    expect(await getCollectorByHandle('newname')).toEqual({ status: 'error' });
    stubFetch(200, { handle: 'newname', previousHandles: [1, 2] }); // non-string elements
    expect(await getCollectorByHandle('newname')).toEqual({ status: 'error' });
  });

  it('rejects an implausible handle locally → not_found without any fetch', async () => {
    // The local gate is a conservative superset (charset + length ≤24), so it only rejects handles the
    // backend could never accept. A backend-valid handle must NOT be rejected here (see todo 108).
    const fetchFn = stubFetch(200, { handle: 'x', previousHandles: [] });
    expect(await getCollectorByHandle('has space')).toEqual({ status: 'not_found' }); // whitespace
    expect(await getCollectorByHandle('bad/slash')).toEqual({ status: 'not_found' }); // illegal char
    expect(await getCollectorByHandle('x'.repeat(25))).toEqual({ status: 'not_found' }); // too long
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
