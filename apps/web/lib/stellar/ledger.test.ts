import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getCurrentLedger } from '@/lib/stellar/ledger';
import { STELLAR_NETWORK } from '@/lib/constants';

function ledgersPage(sequence: number | string) {
  return { _embedded: { records: [{ sequence }] } };
}

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCurrentLedger', () => {
  it('returns the latest ledger sequence from _embedded.records[0]', async () => {
    const fetchFn = stubFetch(200, ledgersPage(123456));
    expect(await getCurrentLedger()).toBe(123456);

    // Public Horizon read: no auth header, hits the horizon origin's /ledgers, never API_BASE_URL.
    const [url] = fetchFn.mock.calls[0];
    expect(url.startsWith(STELLAR_NETWORK.horizonUrl)).toBe(true);
    expect(url).toContain('/ledgers');
  });

  it('coerces a string sequence to a number', async () => {
    stubFetch(200, ledgersPage('987654'));
    expect(await getCurrentLedger()).toBe(987654);
  });

  it('returns null on a network rejection (fail-soft, never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await getCurrentLedger()).toBeNull();
  });

  it('returns null on a non-ok status', async () => {
    stubFetch(503, {});
    expect(await getCurrentLedger()).toBeNull();
  });

  it('returns null on empty records', async () => {
    stubFetch(200, { _embedded: { records: [] } });
    expect(await getCurrentLedger()).toBeNull();
  });

  it('returns null on an unparseable body', async () => {
    stubFetch(200, { nope: true });
    expect(await getCurrentLedger()).toBeNull();
  });

  it('returns null when the sequence is not a finite number', async () => {
    stubFetch(200, ledgersPage('not-a-number'));
    expect(await getCurrentLedger()).toBeNull();
  });
});
