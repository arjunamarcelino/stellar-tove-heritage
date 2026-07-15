import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkHandle } from '@/lib/handle/checkHandle';

const OLD_ENV = process.env;

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

beforeEach(() => {
  process.env = { ...OLD_ENV, NEXT_PUBLIC_API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('checkHandle', () => {
  it('GETs the public endpoint with the handle and NO Authorization header', async () => {
    const fetchFn = stubFetch(200, { available: true });
    await checkHandle('jane_doe');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/handles/check?handle=jane_doe');
    // Direct public call — never send credentials.
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it('rejects a malformed handle (defense-in-depth) without touching the network', async () => {
    const fetchFn = stubFetch(200, { available: true });
    expect(await checkHandle('a b')).toEqual({ status: 'unavailable', reason: 'invalid_format' });
    expect(await checkHandle('ab')).toEqual({ status: 'unavailable', reason: 'invalid_format' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps available:true to { status: available }', async () => {
    stubFetch(200, { handle: 'jane', available: true });
    expect(await checkHandle('jane')).toEqual({ status: 'available' });
  });

  it('maps each unavailable reason', async () => {
    for (const reason of ['taken', 'reserved', 'invalid_format'] as const) {
      stubFetch(200, { handle: 'jane', available: false, reason });
      expect(await checkHandle('jane')).toEqual({ status: 'unavailable', reason });
    }
  });

  it('defaults a reasonless unavailable to invalid_format', async () => {
    stubFetch(200, { handle: 'jane', available: false });
    expect(await checkHandle('jane')).toEqual({ status: 'unavailable', reason: 'invalid_format' });
  });

  it('maps 429 to RATE_LIMITED and other non-2xx to SERVER_ERROR', async () => {
    stubFetch(429, {});
    expect(await checkHandle('jane')).toEqual({ status: 'error', code: 'RATE_LIMITED' });
    stubFetch(400, {});
    expect(await checkHandle('jane')).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('maps a schema-invalid 200 body to SERVER_ERROR', async () => {
    stubFetch(200, { available: 'yes' });
    expect(await checkHandle('jane')).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('maps a thrown/aborted fetch to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    expect(await checkHandle('jane')).toEqual({ status: 'error', code: 'NETWORK_ERROR' });
  });

  it('times out a hung check to NETWORK_ERROR (bounded, never stuck)', async () => {
    vi.useFakeTimers();
    // A fetch that never responds but rejects when its signal aborts (what the browser does on abort).
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const pending = checkHandle('jane', undefined, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ status: 'error', code: 'NETWORK_ERROR' });
    vi.useRealTimers();
  });

  it('returns SERVER_ERROR when the public base URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(await checkHandle('jane')).toEqual({ status: 'error', code: 'SERVER_ERROR' });
  });
});
