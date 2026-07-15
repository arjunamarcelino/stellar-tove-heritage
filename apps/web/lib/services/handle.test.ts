import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { setHandle, getHandle } from '@/lib/services/handle';

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

describe('setHandle', () => {
  it('POSTs the handle with a Bearer header and returns success on a valid 200 body', async () => {
    const fetchFn = stubFetch(200, { handle: 'Maya', handleCanonical: 'maya' });
    const result = await setHandle('tok', 'Maya');
    expect(result).toEqual({ status: 'success' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/handle');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ handle: 'Maya' });
  });

  it('maps each backend errorCode', async () => {
    const cases: Array<[number, string]> = [
      [409, 'HANDLE_TAKEN'],
      [422, 'HANDLE_FORMAT_INVALID'],
      [422, 'HANDLE_RESERVED'],
      [429, 'RATE_LIMITED'],
    ];
    for (const [status, code] of cases) {
      stubFetch(status, { errorCode: code });
      expect(await setHandle('tok', 'Maya')).toMatchObject({ status: 'error', code });
    }
  });

  it('falls back to SESSION_EXPIRED on a 401 with or without a recognized code', async () => {
    stubFetch(401, { errorCode: 'AUTH_REQUIRED' });
    expect(await setHandle('tok', 'Maya')).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(401, {});
    expect(await setHandle('tok', 'Maya')).toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('collapses a 400/404 status fallback to SERVER_ERROR (outside the handle union)', async () => {
    stubFetch(400, {});
    expect(await setHandle('tok', 'Maya')).toMatchObject({ code: 'SERVER_ERROR' });
    stubFetch(404, {});
    expect(await setHandle('tok', 'Maya')).toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('maps a schema-invalid 200 body to SERVER_ERROR and never surfaces a raw message', async () => {
    stubFetch(200, { handle: 'Maya', message: 'internal detail' });
    const result = await setHandle('tok', 'Maya');
    expect(result).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    if (result.status === 'error') expect(result.message).not.toContain('internal detail');
  });

  it('maps a transport failure (status 0) to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await setHandle('tok', 'Maya')).toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('getHandle', () => {
  it('GETs with a Bearer header and returns the current handle', async () => {
    const fetchFn = stubFetch(200, { handle: 'Maya' });
    expect(await getHandle('tok')).toEqual({ status: 'success', handle: 'Maya' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/handle');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns handle: null when unclaimed (null, missing, or empty string)', async () => {
    stubFetch(200, { handle: null });
    expect(await getHandle('tok')).toEqual({ status: 'success', handle: null });
    stubFetch(200, {});
    expect(await getHandle('tok')).toEqual({ status: 'success', handle: null });
    stubFetch(200, { handle: '' });
    expect(await getHandle('tok')).toEqual({ status: 'success', handle: null });
  });

  it('maps 401 to SESSION_EXPIRED and status 0 to NETWORK_ERROR', async () => {
    stubFetch(401, {});
    expect(await getHandle('tok')).toEqual({ status: 'error', code: 'SESSION_EXPIRED' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getHandle('tok')).toEqual({ status: 'error', code: 'NETWORK_ERROR' });
  });
});
