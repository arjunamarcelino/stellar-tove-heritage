import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { createRfq } from '@/lib/services/rfqs';
import { RFQ_MESSAGES } from '@/lib/rfq/rfqMessages';
import {
  ARTWORK_ID,
  IDEM_KEY,
  rfqWire,
  rfqWireWithWarning,
  rfq,
  rfqWithWarning,
  rfqInput,
} from '@/test/fixtures/rfq';
import type { RfqBackendErrorCode } from '@/lib/types/api';

const OLD_ENV = process.env;
const TOKEN = 'access-tok';

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

describe('createRfq', () => {
  it('POSTs the RFQ with Bearer + Idempotency-Key headers, camelCase body incl. explicit expiryHours, and maps the 201', async () => {
    const fetchFn = stubFetch(201, rfqWire);
    const result = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
    expect(result).toEqual({ status: 'success', rfq });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/api/v1/marketplace/rfqs');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Idempotency-Key']).toBe(IDEM_KEY);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      artworkId: ARTWORK_ID,
      fractionCount: 100,
      maxPricePerFractionStroops: '150000000',
      expiryHours: 72, // explicit, never omitted (canonical idempotency body)
    });
    expect(init.cache).toBeUndefined(); // POST — never route-cached
  });

  it('keeps big-integer amounts as exact strings (never NaN/number)', async () => {
    stubFetch(201, {
      ...rfqWire,
      fractionCount: '9007199254740993',
      maxPricePerFractionStroops: '79228162514264337593543950335',
    });
    const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.rfq.fractionCount).toBe('9007199254740993');
    expect(r.rfq.maxPricePerFractionStroops).toBe('79228162514264337593543950335');
  });

  it('parses balanceWarning when present', async () => {
    stubFetch(201, rfqWireWithWarning);
    const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
    expect(r).toEqual({ status: 'success', rfq: rfqWithWarning });
  });

  it('leaves balanceWarning undefined when the backend omits it (never fabricated)', async () => {
    stubFetch(201, rfqWire);
    const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.rfq.balanceWarning).toBeUndefined();
    expect('balanceWarning' in r.rfq).toBe(false);
  });

  it('drops internal ids — the mapped Rfq echoes no collectorSub / fractionContractId / createdAt (egress)', async () => {
    stubFetch(201, rfqWire);
    const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
    if (r.status !== 'success') throw new Error('expected success');
    expect(Object.keys(r.rfq).sort()).toEqual(
      ['expiresAt', 'fractionCount', 'id', 'maxPricePerFractionStroops', 'status'].sort(),
    );
  });

  it('SEC-1: a non-uuid artwork id short-circuits to ARTWORK_NOT_FOUND without a fetch', async () => {
    const fetchFn = stubFetch(201, rfqWire);
    const r = await createRfq(TOKEN, 'not-a-uuid', rfqInput, IDEM_KEY);
    expect(r).toEqual({
      status: 'error',
      code: 'ARTWORK_NOT_FOUND',
      message: RFQ_MESSAGES.ARTWORK_NOT_FOUND,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a zero / oversized (> 2^96-1) price as RFQ_INVALID_PRICE before any fetch', async () => {
    const fetchFn = stubFetch(201, rfqWire);
    const zero = await createRfq(
      TOKEN,
      ARTWORK_ID,
      { ...rfqInput, maxPricePerFractionStroops: '0' },
      IDEM_KEY,
    );
    expect(zero.status === 'error' && zero.code).toBe('RFQ_INVALID_PRICE');
    const over = await createRfq(
      TOKEN,
      ARTWORK_ID,
      { ...rfqInput, maxPricePerFractionStroops: '79228162514264337593543950336' }, // 2^96
      IDEM_KEY,
    );
    expect(over.status === 'error' && over.code).toBe('RFQ_INVALID_PRICE');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('accepts price = 2^96-1 (the max) and multiplies safely for the overflow bound', async () => {
    stubFetch(201, rfqWire);
    const r = await createRfq(
      TOKEN,
      ARTWORK_ID,
      {
        fractionCount: 1,
        maxPricePerFractionStroops: '79228162514264337593543950335',
        expiryHours: 48,
      },
      IDEM_KEY,
    );
    expect(r.status).toBe('success');
  });

  it('rejects price × count > i128 as RFQ_AMOUNT_OVERFLOW (independent of the price bound)', async () => {
    const fetchFn = stubFetch(201, rfqWire);
    // price ≤ 2^96-1 but count large enough that the product exceeds 2^127-1.
    const r = await createRfq(
      TOKEN,
      ARTWORK_ID,
      {
        fractionCount: 9_000_000_000_000_000,
        maxPricePerFractionStroops: '79228162514264337593543950335',
        expiryHours: 48,
      },
      IDEM_KEY,
    );
    expect(r.status === 'error' && r.code).toBe('RFQ_AMOUNT_OVERFLOW');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a non-preset expiry_hours as VALIDATION_FAILED without a fetch (service defense-in-depth)', async () => {
    const fetchFn = stubFetch(201, rfqWire);
    const r = await createRfq(TOKEN, ARTWORK_ID, { ...rfqInput, expiryHours: 5 as 24 }, IDEM_KEY);
    expect(r.status === 'error' && r.code).toBe('VALIDATION_FAILED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a non-integer / < 1 fraction count as VALIDATION_FAILED', async () => {
    stubFetch(201, rfqWire);
    const r = await createRfq(TOKEN, ARTWORK_ID, { ...rfqInput, fractionCount: 0 }, IDEM_KEY);
    expect(r.status === 'error' && r.code).toBe('VALIDATION_FAILED');
  });

  it('fails closed on a malformed 201 body (missing money fields) → SERVER_ERROR', async () => {
    stubFetch(201, { id: 'only-an-id' });
    const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
    expect(r).toEqual({
      status: 'error',
      code: 'SERVER_ERROR',
      message: RFQ_MESSAGES.SERVER_ERROR,
    });
  });

  it('fails closed on an unparseable expiresAt → SERVER_ERROR (never throws in render downstream)', async () => {
    stubFetch(201, { ...rfqWire, expiresAt: 'not-a-date' });
    const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
    expect(r).toEqual({
      status: 'error',
      code: 'SERVER_ERROR',
      message: RFQ_MESSAGES.SERVER_ERROR,
    });
  });

  it('sends the amount as a JSON string even if a forged input passed a number', async () => {
    const fetchFn = stubFetch(201, rfqWire);
    await createRfq(
      TOKEN,
      ARTWORK_ID,
      { ...rfqInput, maxPricePerFractionStroops: 150000000 as unknown as string },
      IDEM_KEY,
    );
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(typeof body.maxPricePerFractionStroops).toBe('string');
    expect(body.maxPricePerFractionStroops).toBe('150000000');
    expect(typeof body.fractionCount).toBe('number'); // number per the TOV-172 contract
  });

  it('maps every backend errorCode through the passthrough table', async () => {
    const codes: RfqBackendErrorCode[] = [
      'VALIDATION_FAILED',
      'RFQ_NOT_WHITELISTED',
      'ARTWORK_NOT_FOUND',
      'RFQ_ARTWORK_NOT_FRACTIONALIZED',
      'RFQ_INVALID_PRICE',
      'RFQ_AMOUNT_OVERFLOW',
      'RFQ_TOO_MANY_ACTIVE',
      'IDEMPOTENCY_KEY_IN_FLIGHT',
      'IDEMPOTENCY_KEY_MISMATCH',
    ];
    for (const code of codes) {
      stubFetch(422, { errorCode: code, message: 'raw backend detail that must NOT surface' });
      const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
      expect(r).toEqual({ status: 'error', code, message: RFQ_MESSAGES[code] });
    }
  });

  it('maps transport statuses via the dedicated fallback (401/429/0/other) — never WALLET_NOT_FOUND', async () => {
    const cases: Array<[number, string]> = [
      [401, 'SESSION_EXPIRED'],
      [429, 'RATE_LIMITED'],
      [0, 'NETWORK_ERROR'],
      [500, 'SERVER_ERROR'],
      [404, 'SERVER_ERROR'], // codeless 404 must NOT become WALLET_NOT_FOUND
    ];
    for (const [status, expected] of cases) {
      stubFetch(status, status === 0 ? null : {}, false);
      const r = await createRfq(TOKEN, ARTWORK_ID, rfqInput, IDEM_KEY);
      expect(r.status === 'error' && r.code).toBe(expected);
    }
  });
});
