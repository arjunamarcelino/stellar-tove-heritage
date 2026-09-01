import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api-client';

type MockedFetch = ReturnType<typeof vi.fn>;

function stubOkFetch(): MockedFetch {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headersOf(fetchMock: MockedFetch): Record<string, string> {
  const call = fetchMock.mock.calls.at(0);
  if (!call) throw new Error('fetch was not called');
  return (call[1] as RequestInit).headers as Record<string, string>;
}

describe('api-client idempotency + CSRF headers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('attaches Idempotency-Key when provided (positive)', async () => {
    const f = stubOkFetch();
    await api.post('/api/x', { a: 1 }, { idempotencyKey: 'key-12345678' });
    expect(headersOf(f)['Idempotency-Key']).toBe('key-12345678');
  });

  it('omits Idempotency-Key when not provided, keeps CSRF (negative)', async () => {
    const f = stubOkFetch();
    await api.post('/api/x', { a: 1 });
    expect(headersOf(f)['Idempotency-Key']).toBeUndefined();
    expect(headersOf(f)['X-CSRF-Protection']).toBe('1');
  });

  it('always sets reserved CSRF + Content-Type on state-changing calls (edge)', async () => {
    const f = stubOkFetch();
    await api.patch('/api/x', {}, { idempotencyKey: 'abcdefgh' });
    const h = headersOf(f);
    expect(h['X-CSRF-Protection']).toBe('1');
    expect(h['Content-Type']).toBe('application/json');
  });
});
