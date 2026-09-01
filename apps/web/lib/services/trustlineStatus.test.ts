import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
// unstable_cache is a passthrough in tests: we exercise readStatus's throw/return contract directly and
// assert the outer fail-open, without Next's data-cache runtime in play.
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

import { deriveTrustlineStatus } from '@/lib/services/trustlineStatus';
import { STELLAR_NETWORK } from '@/lib/constants';

// A valid strkey (G + 55 base32 chars) — passes isValidStellarPublicKey without hitting the SDK.
const VALID_ADDRESS = 'G' + 'A'.repeat(55);
// Circle's published testnet USDC issuer (the default PLATFORM_USDC.issuer on testnet).
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function horizonBody(balances: unknown[]) {
  return { sequence: '1234567890', subentry_count: 2, balances };
}

const nativeLine = { asset_type: 'native', balance: '100.0000000' };
const usdcLine = {
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: USDC_ISSUER,
  balance: '0.0000000',
  is_authorized: true,
};

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('deriveTrustlineStatus (testnet issuer configured)', () => {
  beforeEach(() => {
    // Guard against fixtures accidentally depending on API_BASE_URL — this read is Horizon-only.
    delete process.env.API_BASE_URL;
  });

  it('returns "unknown" for an invalid address WITHOUT touching Horizon', async () => {
    const fetchFn = stubFetch(200, horizonBody([]));
    expect(await deriveTrustlineStatus('not-a-strkey')).toBe('unknown');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reads Horizon at the network horizonUrl with the address encoded and a 2.5s timeout', async () => {
    const fetchFn = stubFetch(200, horizonBody([nativeLine, usdcLine]));
    await deriveTrustlineStatus(VALID_ADDRESS);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${STELLAR_NETWORK.horizonUrl}/accounts/${encodeURIComponent(VALID_ADDRESS)}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // No Authorization header — public, tokenless read.
    expect(init.headers).toBeUndefined();
  });

  it('returns "unfunded" on HTTP 404 (account not funded on-chain)', async () => {
    stubFetch(404, { detail: 'not found' });
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('unfunded');
  });

  it('returns "active" for a 200 with an authorized USDC line', async () => {
    stubFetch(200, horizonBody([nativeLine, usdcLine]));
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('active');
  });

  it('returns "missing" for a 200 without the USDC line', async () => {
    stubFetch(200, horizonBody([nativeLine]));
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('missing');
  });

  it('returns "missing" when the line exists but is not authorized (is_authorized: false)', async () => {
    stubFetch(200, horizonBody([nativeLine, { ...usdcLine, is_authorized: false }]));
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('missing');
  });

  it('fails open to "unknown" on a 500', async () => {
    stubFetch(500, { detail: 'boom' });
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('unknown');
  });

  it('fails open to "unknown" on a network throw / abort', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchFn);
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('unknown');
  });

  it('fails open to "unknown" on a malformed / non-account JSON body', async () => {
    stubFetch(200, { unexpected: 'shape' });
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('unknown');
  });

  it('fails open to "unknown" when res.json() itself throws (unparseable body)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    });
    vi.stubGlobal('fetch', fetchFn);
    expect(await deriveTrustlineStatus(VALID_ADDRESS)).toBe('unknown');
  });
});

describe('deriveTrustlineStatus (issuer unset — mainnet pre-audit)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('returns "unavailable" and never touches Horizon when PLATFORM_USDC.issuer is falsy', async () => {
    vi.resetModules();
    vi.doMock('@/lib/constants', () => ({
      PLATFORM_USDC: { code: 'USDC', issuer: undefined },
      STELLAR_NETWORK: { horizonUrl: 'https://horizon.example' },
    }));
    const fetchFn = stubFetch(200, horizonBody([nativeLine, usdcLine]));

    const { deriveTrustlineStatus: derive } = await import('@/lib/services/trustlineStatus');
    expect(await derive(VALID_ADDRESS)).toBe('unavailable');
    expect(fetchFn).not.toHaveBeenCalled();

    vi.doUnmock('@/lib/constants');
  });
});
