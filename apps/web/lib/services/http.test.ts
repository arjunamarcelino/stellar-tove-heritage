import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { postJson, getJson, deleteJson } from '@/lib/services/http';

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

describe('postJson', () => {
  it('returns status 0 without fetching when API_BASE_URL is unset', async () => {
    delete process.env.API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await postJson('/x', { a: 1 })).toEqual({ ok: false, status: 0, data: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs JSON with the Content-Type header and returns the parsed body', async () => {
    const fetchFn = stubFetch(200, { ok: true });
    const outcome = await postJson('/thing', { name: 'leo' });
    expect(outcome).toEqual({ ok: true, status: 200, data: { ok: true } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/thing');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ name: 'leo' });
  });

  it('merges caller headers (e.g. Authorization) with Content-Type', async () => {
    const fetchFn = stubFetch(200, {});
    await postJson('/thing', {}, { headers: { Authorization: 'Bearer abc' } });
    const init = fetchFn.mock.calls[0][1];
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc',
    });
  });

  it('maps a thrown fetch (network/abort) to status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await postJson('/thing', {})).toEqual({ ok: false, status: 0, data: null });
  });

  it('maps an unparseable body to data: null while preserving status/ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      }),
    );
    expect(await postJson('/thing', {})).toEqual({ ok: false, status: 503, data: null });
  });

  it('passes an AbortSignal when a timeout is given', async () => {
    const fetchFn = stubFetch(200, {});
    await postJson('/thing', {}, { timeoutMs: 5000 });
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('getJson', () => {
  it('returns status 0 without fetching when API_BASE_URL is unset', async () => {
    delete process.env.API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getJson('/wallets')).toEqual({ ok: false, status: 0, data: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GETs with a Bearer header and no body or Content-Type', async () => {
    const fetchFn = stubFetch(200, [{ id: 'w1' }]);
    const outcome = await getJson('/v1/me/wallets', { headers: { Authorization: 'Bearer tok' } });
    expect(outcome).toEqual({ ok: true, status: 200, data: [{ id: 'w1' }] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/wallets');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('maps a thrown fetch to status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getJson('/wallets')).toEqual({ ok: false, status: 0, data: null });
  });
});

describe('deleteJson', () => {
  it('DELETEs with a Bearer header and no body or Content-Type', async () => {
    const fetchFn = stubFetch(204, {});
    await deleteJson('/v1/me/wallets/w1', { headers: { Authorization: 'Bearer tok' } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/wallets/w1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('resolves a 204 empty body to { ok: true, status: 204, data: null }', async () => {
    // A 204 has no body: res.json() rejects and the defensive catch sets data = null. removeWallet
    // relies on this to treat 204 as success without conflating it with a status-0 failure.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: vi.fn().mockRejectedValue(new Error('no content')),
      }),
    );
    expect(await deleteJson('/v1/me/wallets/w1')).toEqual({ ok: true, status: 204, data: null });
  });

  it('maps a thrown/timed-out DELETE to status 0 (not a false success)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await deleteJson('/v1/me/wallets/w1')).toEqual({ ok: false, status: 0, data: null });
  });
});
