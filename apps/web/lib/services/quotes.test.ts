import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { submitQuote } from '@/lib/services/quotes';
import { QUOTE_MESSAGES } from '@/lib/quote/quoteMessages';
import {
  RFQ_ID,
  IDEM_KEY,
  quoteWire,
  quoteWireCapped,
  insufficientBalanceBody,
  quote,
  quoteCapped,
  quoteInput,
} from '@/test/fixtures/quote';
import type { QuoteBackendErrorCode } from '@/lib/types/api';

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

describe('submitQuote', () => {
  it('POSTs to /rfqs/{rfqId}/quotes with Bearer + Idempotency-Key headers, camelCase body, and maps the 201', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    const result = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    expect(result).toEqual({ status: 'success', quote });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/api/v1/marketplace/rfqs/${RFQ_ID}/quotes`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Idempotency-Key']).toBe(IDEM_KEY);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      pricePerFractionStroops: '150000000',
      fractionCount: 25,
      validUntil: '2026-08-25T12:00:00.000Z',
    });
    expect(init.cache).toBeUndefined(); // POST — never route-cached
  });

  it('keeps big-integer amounts as exact strings (never NaN/number)', async () => {
    stubFetch(201, {
      ...quoteWire,
      fractionCount: '9007199254740993',
      pricePerFractionStroops: '79228162514264337593543950335',
    });
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.quote.fractionCount).toBe('9007199254740993');
    expect(r.quote.pricePerFractionStroops).toBe('79228162514264337593543950335');
  });

  it('parses validUntilCapped:true when present (and uses the capped validUntil)', async () => {
    stubFetch(201, quoteWireCapped);
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    expect(r).toEqual({ status: 'success', quote: quoteCapped });
  });

  it('leaves validUntilCapped undefined when the backend omits it (never fabricated as false)', async () => {
    stubFetch(201, quoteWire);
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.quote.validUntilCapped).toBeUndefined();
    expect('validUntilCapped' in r.quote).toBe(false);
  });

  it('accepts validUntilCapped:false (the common uncapped path) → success, key absent (not a false SERVER_ERROR)', async () => {
    stubFetch(201, { ...quoteWire, validUntilCapped: false });
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.quote.validUntilCapped).toBeUndefined();
    expect('validUntilCapped' in r.quote).toBe(false);
  });

  it('drops internal ids — the mapped Quote echoes no holderSub / fractionContractId / createdAt (egress)', async () => {
    stubFetch(201, quoteWire);
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    if (r.status !== 'success') throw new Error('expected success');
    expect(Object.keys(r.quote).sort()).toEqual(
      ['fractionCount', 'id', 'pricePerFractionStroops', 'rfqId', 'status', 'validUntil'].sort(),
    );
  });

  it('SEC-1: a non-uuid rfqId short-circuits to QUOTE_RFQ_NOT_FOUND without a fetch', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    const r = await submitQuote(TOKEN, 'not-a-uuid', quoteInput, IDEM_KEY);
    expect(r).toEqual({
      status: 'error',
      code: 'QUOTE_RFQ_NOT_FOUND',
      message: QUOTE_MESSAGES.QUOTE_RFQ_NOT_FOUND,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a malformed idempotency key short-circuits to SERVER_ERROR without a fetch', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, 'not-a-uuid');
    expect(r.status === 'error' && r.code).toBe('SERVER_ERROR');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a zero / oversized (> 2^96-1) price as QUOTE_INVALID_PRICE before any fetch', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    const zero = await submitQuote(
      TOKEN,
      RFQ_ID,
      { ...quoteInput, pricePerFractionStroops: '0' },
      IDEM_KEY,
    );
    expect(zero.status === 'error' && zero.code).toBe('QUOTE_INVALID_PRICE');
    const over = await submitQuote(
      TOKEN,
      RFQ_ID,
      { ...quoteInput, pricePerFractionStroops: '79228162514264337593543950336' }, // 2^96
      IDEM_KEY,
    );
    expect(over.status === 'error' && over.code).toBe('QUOTE_INVALID_PRICE');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects price × count > i128 as QUOTE_AMOUNT_OVERFLOW (independent of the price bound)', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    const r = await submitQuote(
      TOKEN,
      RFQ_ID,
      {
        fractionCount: 9_000_000_000_000_000,
        pricePerFractionStroops: '79228162514264337593543950335',
        validUntil: '2026-08-25T12:00:00.000Z',
      },
      IDEM_KEY,
    );
    expect(r.status === 'error' && r.code).toBe('QUOTE_AMOUNT_OVERFLOW');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a non-integer / < 1 fraction count as VALIDATION_FAILED', async () => {
    stubFetch(201, quoteWire);
    const r = await submitQuote(TOKEN, RFQ_ID, { ...quoteInput, fractionCount: 0 }, IDEM_KEY);
    expect(r.status === 'error' && r.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a validUntil without an explicit tz offset as QUOTE_INVALID_VALIDITY, before any fetch', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    const r = await submitQuote(
      TOKEN,
      RFQ_ID,
      { ...quoteInput, validUntil: '2026-08-25T12:00:00' }, // no Z / offset
      IDEM_KEY,
    );
    expect(r.status === 'error' && r.code).toBe('QUOTE_INVALID_VALIDITY');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('C1: a past-but-well-formed validUntil is NOT rejected by bounds (server is the > now authority)', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    const r = await submitQuote(
      TOKEN,
      RFQ_ID,
      { ...quoteInput, validUntil: '2020-01-01T00:00:00.000Z' }, // past, but well-formed + offset
      IDEM_KEY,
    );
    expect(r.status).toBe('success'); // reached the fetch — structure-only bounds let it through
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('fails closed on a malformed 201 body (missing money fields) → SERVER_ERROR', async () => {
    stubFetch(201, { id: 'only-an-id' });
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    expect(r).toEqual({
      status: 'error',
      code: 'SERVER_ERROR',
      message: QUOTE_MESSAGES.SERVER_ERROR,
    });
  });

  it('fails closed on a non-numeric fractionCount in the 201 → SERVER_ERROR (never throws downstream)', async () => {
    stubFetch(201, { ...quoteWire, fractionCount: '25.5' });
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    expect(r.status === 'error' && r.code).toBe('SERVER_ERROR');
  });

  it('fails closed on a degenerate "0" price/count in the 201 → SERVER_ERROR (stricter receive-side guard)', async () => {
    stubFetch(201, { ...quoteWire, pricePerFractionStroops: '0' });
    expect((await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY)).status).toBe('error');
    stubFetch(201, { ...quoteWire, fractionCount: '0' });
    expect((await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY)).status).toBe('error');
  });

  it('fails closed on an unparseable validUntil → SERVER_ERROR (never throws in render downstream)', async () => {
    stubFetch(201, { ...quoteWire, validUntil: 'not-a-date' });
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    expect(r.status === 'error' && r.code).toBe('SERVER_ERROR');
  });

  it('sends the amount as a JSON string even if a forged input passed a number; count stays a number', async () => {
    const fetchFn = stubFetch(201, quoteWire);
    await submitQuote(
      TOKEN,
      RFQ_ID,
      { ...quoteInput, pricePerFractionStroops: 150000000 as unknown as string },
      IDEM_KEY,
    );
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(typeof body.pricePerFractionStroops).toBe('string');
    expect(body.pricePerFractionStroops).toBe('150000000');
    expect(typeof body.fractionCount).toBe('number'); // number per the TOV-175 contract
  });

  it('QUOTE_INSUFFICIENT_FREE_BALANCE → curated message + parsed balanceDetail (decimal strings)', async () => {
    stubFetch(422, insufficientBalanceBody);
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    expect(r).toEqual({
      status: 'error',
      code: 'QUOTE_INSUFFICIENT_FREE_BALANCE',
      message: QUOTE_MESSAGES.QUOTE_INSUFFICIENT_FREE_BALANCE,
      balanceDetail: { requiredFractionCount: '25', freeFractionCount: '5' },
    });
  });

  it('QUOTE_INSUFFICIENT_FREE_BALANCE with malformed counts → code maps, balanceDetail dropped (never fabricated)', async () => {
    stubFetch(422, {
      errorCode: 'QUOTE_INSUFFICIENT_FREE_BALANCE',
      requiredFractionCount: '25.5', // malformed
      freeFractionCount: 'oops',
    });
    const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
    if (r.status !== 'error') throw new Error('expected error');
    expect(r.code).toBe('QUOTE_INSUFFICIENT_FREE_BALANCE');
    expect('balanceDetail' in r).toBe(false);
  });

  it('maps every backend errorCode through the passthrough table (raw message never surfaced)', async () => {
    const codes: QuoteBackendErrorCode[] = [
      'VALIDATION_FAILED',
      'QUOTE_NOT_WHITELISTED',
      'QUOTE_RFQ_NOT_FOUND',
      'QUOTE_ALREADY_OPEN',
      'IDEMPOTENCY_KEY_IN_FLIGHT',
      'QUOTE_RFQ_NOT_OPEN',
      'QUOTE_RFQ_EXPIRED',
      'QUOTE_ON_OWN_RFQ',
      'QUOTE_INVALID_PRICE',
      'QUOTE_AMOUNT_OVERFLOW',
      'QUOTE_INVALID_VALIDITY',
      'QUOTE_NO_SETTLEMENT_WALLET',
      'IDEMPOTENCY_KEY_MISMATCH',
      'QUOTE_BALANCE_UNAVAILABLE',
    ];
    for (const code of codes) {
      stubFetch(422, { errorCode: code, message: 'raw backend detail that must NOT surface' });
      const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
      expect(r).toEqual({ status: 'error', code, message: QUOTE_MESSAGES[code] });
    }
  });

  it('maps transport statuses via the dedicated fallback (401/429/503/0/other) — never WALLET_NOT_FOUND', async () => {
    const cases: Array<[number, string]> = [
      [401, 'SESSION_EXPIRED'],
      [429, 'RATE_LIMITED'],
      [503, 'QUOTE_BALANCE_UNAVAILABLE'], // codeless 503 → retryable balance-unavailable
      [0, 'NETWORK_ERROR'],
      [500, 'SERVER_ERROR'],
      [404, 'SERVER_ERROR'], // codeless 404 must NOT become WALLET_NOT_FOUND
      [409, 'SERVER_ERROR'], // codeless 409 is overloaded → fails safe
    ];
    for (const [status, expected] of cases) {
      stubFetch(status, status === 0 ? null : {}, false);
      const r = await submitQuote(TOKEN, RFQ_ID, quoteInput, IDEM_KEY);
      expect(r.status === 'error' && r.code).toBe(expected);
    }
  });
});
