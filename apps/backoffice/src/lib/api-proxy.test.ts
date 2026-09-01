// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./auth', () => ({
  getAuthToken: vi.fn(async () => 'test-token'),
  clearAuthCookies: vi.fn(async () => undefined),
  refreshTokenIfNeeded: vi.fn(async () => false),
}));
vi.mock('./env', () => ({
  getEnv: () => ({ BACKEND_API_URL: 'https://backend.test', NODE_ENV: 'test' }),
}));

import { proxyToBackend } from './api-proxy';

type MockedFetch = ReturnType<typeof vi.fn>;

function makeRequest(extraHeaders: Record<string, string>) {
  return new Request('https://app.test/api/artworks/abc/fractionalize', {
    method: 'POST',
    headers: {
      'x-csrf-protection': '1',
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ a: 1 }),
  });
}

function forwardedHeaders(): Record<string, string> {
  const f = globalThis.fetch as unknown as MockedFetch;
  const call = f.mock.calls.at(0);
  if (!call) throw new Error('fetch was not called');
  return (call[1] as RequestInit).headers as Record<string, string>;
}

describe('proxyToBackend Idempotency-Key forwarding', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
  });

  it('forwards a valid Idempotency-Key (positive)', async () => {
    await proxyToBackend(
      makeRequest({ 'idempotency-key': 'abcdefgh1234' }),
      '/backoffice/artworks/abc/fractionalize',
      { body: { a: 1 } },
    );
    expect(forwardedHeaders()['Idempotency-Key']).toBe('abcdefgh1234');
  });

  it('omits the header when the client did not send one (negative)', async () => {
    await proxyToBackend(makeRequest({}), '/backoffice/artworks/abc/fractionalize', {
      body: { a: 1 },
    });
    expect(forwardedHeaders()['Idempotency-Key']).toBeUndefined();
  });

  it('rejects a malformed key: too short / illegal chars (edge)', async () => {
    await proxyToBackend(
      makeRequest({ 'idempotency-key': 'short' }),
      '/backoffice/artworks/abc/fractionalize',
      { body: { a: 1 } },
    );
    expect(forwardedHeaders()['Idempotency-Key']).toBeUndefined();
  });
});

describe('proxyToBackend error-body sanitization', () => {
  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
  }

  it('collapses a 5xx body to a generic error (no internal leak)', async () => {
    stubFetch(500, { error: { message: 'DB exploded at line 42', code: 'PG_1234' }, stack: 'secret' });
    const res = await proxyToBackend(makeRequest({}), '/backoffice/artworks/abc', { body: { a: 1 } });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: { message: 'Upstream server error', code: 'UPSTREAM_ERROR' },
    });
  });

  it('forwards only message + code on a 4xx, stripping extra fields', async () => {
    stubFetch(409, {
      error: { message: 'Already', code: 'ARTWORK_ALREADY_FRACTIONALIZED', internal: 'x' },
    });
    const res = await proxyToBackend(makeRequest({}), '/backoffice/artworks/abc/fractionalize', {
      body: { a: 1 },
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: { message: 'Already', code: 'ARTWORK_ALREADY_FRACTIONALIZED' },
    });
  });
});
