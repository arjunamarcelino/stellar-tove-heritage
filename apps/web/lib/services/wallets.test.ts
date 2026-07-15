import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fakeEmbeddedWallet,
  fakeByowWallet,
  fakePrimaryWallet,
  fakeAddedByowWallet,
} from '@/test/fixtures/walletExport';

vi.mock('server-only', () => ({}));

import { listWallets } from '@/lib/services/wallets';

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

describe('listWallets', () => {
  it('GETs /v1/me/wallets with a Bearer header and returns the parsed list', async () => {
    const fetchFn = stubFetch(200, [fakeEmbeddedWallet, fakeByowWallet]);
    const result = await listWallets('tok');
    expect(result).toEqual({ status: 'success', wallets: [fakeEmbeddedWallet, fakeByowWallet] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/wallets');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns NETWORK_ERROR when API_BASE_URL is unset (no fetch)', async () => {
    delete process.env.API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await listWallets('tok')).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 401 to SESSION_EXPIRED and 429 to RATE_LIMITED', async () => {
    stubFetch(401, {});
    expect(await listWallets('tok')).toMatchObject({ status: 'error', code: 'SESSION_EXPIRED' });
    stubFetch(429, {});
    expect(await listWallets('tok')).toMatchObject({ status: 'error', code: 'RATE_LIMITED' });
  });

  it('returns SERVER_ERROR when the body fails schema validation', async () => {
    stubFetch(200, [{ id: 'w1', kind: 'unknown-kind', address: 'C…', exported: false }]);
    expect(await listWallets('tok')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('parses the enriched TOV-24 shape (isPrimary + createdAt)', async () => {
    stubFetch(200, [fakePrimaryWallet, fakeAddedByowWallet]);
    expect(await listWallets('tok')).toEqual({
      status: 'success',
      wallets: [fakePrimaryWallet, fakeAddedByowWallet],
    });
  });

  it('is forward-compatible: tolerates missing isPrimary/createdAt and null values', async () => {
    // A backend that hasn't shipped the new fields (missing) or a half-migration (null) must not
    // break the whole list; nulls normalize to undefined.
    stubFetch(200, [
      fakeByowWallet, // no isPrimary/createdAt at all
      { ...fakeEmbeddedWallet, isPrimary: null, createdAt: null },
    ]);
    const result = await listWallets('tok');
    expect(result).toEqual({
      status: 'success',
      wallets: [fakeByowWallet, fakeEmbeddedWallet],
    });
  });
});
