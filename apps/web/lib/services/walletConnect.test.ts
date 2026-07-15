import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { requestChallenge, verifySignature } from '@/lib/services/walletConnect';

const OLD_ENV = process.env;

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) }),
  );
}

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('requestChallenge', () => {
  it('returns xdr + networkPassphrase on 200', async () => {
    stubFetch(200, { challengeTxXdr: 'XDR', networkPassphrase: 'Test SDF' });
    const result = await requestChallenge('GABC');
    expect(result).toEqual({ status: 'success', xdr: 'XDR', networkPassphrase: 'Test SDF' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/v1/auth/sep10/challenge',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns config error when API_BASE_URL is unset', async () => {
    delete process.env.API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await requestChallenge('GABC')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 429 to RATE_LIMITED', async () => {
    stubFetch(429, {}, false);
    expect(await requestChallenge('GABC')).toMatchObject({ status: 'error', code: 'RATE_LIMITED' });
  });

  it('surfaces the backend message on other errors', async () => {
    stubFetch(400, { message: 'bad public key' }, false);
    expect(await requestChallenge('GABC')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'bad public key',
    });
  });

  it('returns NETWORK_ERROR when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await requestChallenge('GABC')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });

  it('returns error on an invalid success shape', async () => {
    stubFetch(200, { nope: true });
    expect(await requestChallenge('GABC')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });
});

describe('verifySignature', () => {
  it('returns tokens on 200', async () => {
    stubFetch(200, { accessToken: 'a', refreshToken: 'r' });
    expect(await verifySignature('SIGNED')).toEqual({
      status: 'success',
      accessToken: 'a',
      refreshToken: 'r',
    });
  });

  it('maps 401 to AUTH_SIGNATURE_INVALID', async () => {
    stubFetch(401, {}, false);
    expect(await verifySignature('SIGNED')).toMatchObject({
      status: 'error',
      code: 'AUTH_SIGNATURE_INVALID',
    });
  });

  it('returns NETWORK_ERROR when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await verifySignature('SIGNED')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });
});
