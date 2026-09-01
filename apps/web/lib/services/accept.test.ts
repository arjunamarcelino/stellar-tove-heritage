import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getRfqDetail, getMyTrade, prepareAccept, submitAccept } from '@/lib/services/accept';
import { ACCEPT_MESSAGES } from '@/lib/accept/acceptMessages';
import {
  RFQ_ID,
  QUOTE_ID,
  TRADE_ID,
  rfqDetailWire,
  rfqDetail,
  prepareAcceptWire,
  prepareAcceptData,
  submitAcceptInput,
  pendingTradeWire,
  pendingTrade,
  settledTradeWire,
  insufficientUsdcBody,
  errorBody,
  GROSS_STROOPS,
} from '@/test/fixtures/accept';

const OLD_ENV = process.env;
const TOKEN = 'access-tok';
const IDEM_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

// A 204 / empty body makes res.json() throw → the http seam resolves data: null.
function stubFetchNoBody(status: number, ok = status >= 200 && status < 300) {
  const fetchFn = vi
    .fn()
    .mockResolvedValue({ ok, status, json: vi.fn().mockRejectedValue(new Error('no body')) });
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

describe('getRfqDetail', () => {
  it('GETs /api/v1/marketplace/rfqs/:id with Bearer + no-store and maps the DTO', async () => {
    const fetchFn = stubFetch(200, rfqDetailWire);
    const result = await getRfqDetail(TOKEN, RFQ_ID);
    expect(result).toEqual({ status: 'success', rfq: rfqDetail });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/api/v1/marketplace/rfqs/${RFQ_ID}`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.cache).toBe('no-store');
  });

  it('re-sorts quotes price ASC defensively even if the backend order differs', async () => {
    // Feed rows in DESC order; the cheaper rival must sort first.
    const reversed = { ...rfqDetailWire, quotes: [...rfqDetailWire.quotes].reverse() };
    stubFetch(200, reversed);
    const r = await getRfqDetail(TOKEN, RFQ_ID);
    if (r.status !== 'success') throw new Error('expected success');
    const prices = r.rfq.quotes.map((q) => BigInt(q.pricePerFractionStroops));
    expect(prices[0]! <= prices[1]!).toBe(true);
  });

  it('keeps the acceptable flag and nullable sellerHandle from the wire', async () => {
    stubFetch(200, {
      ...rfqDetailWire,
      quotes: [{ ...rfqDetailWire.quotes[1], acceptable: false, sellerHandle: '' }],
    });
    const r = await getRfqDetail(TOKEN, RFQ_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.rfq.quotes[0]!.acceptable).toBe(false);
    expect(r.rfq.quotes[0]!.sellerHandle).toBeNull(); // '' → null
  });

  it('keeps big-integer amounts as exact strings', async () => {
    stubFetch(200, {
      ...rfqDetailWire,
      quotes: [
        { ...rfqDetailWire.quotes[1], pricePerFractionStroops: '79228162514264337593543950335' },
      ],
    });
    const r = await getRfqDetail(TOKEN, RFQ_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.rfq.quotes[0]!.pricePerFractionStroops).toBe('79228162514264337593543950335');
  });

  it('fails closed on a "0" / leading-zero positive field (todo 179)', async () => {
    stubFetch(200, {
      ...rfqDetailWire,
      quotes: [{ ...rfqDetailWire.quotes[1], fractionCount: '0' }],
    });
    expect(await getRfqDetail(TOKEN, RFQ_ID)).toMatchObject({ code: 'SERVER_ERROR' });
    stubFetch(200, {
      ...rfqDetailWire,
      quotes: [{ ...rfqDetailWire.quotes[1], grossStroops: '01' }],
    });
    expect(await getRfqDetail(TOKEN, RFQ_ID)).toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('SEC-1: a non-uuid rfqId short-circuits to RFQ_NOT_FOUND without a fetch', async () => {
    const fetchFn = stubFetch(200, rfqDetailWire);
    const r = await getRfqDetail(TOKEN, 'not-a-uuid');
    expect(r).toEqual({
      status: 'error',
      code: 'RFQ_NOT_FOUND',
      message: ACCEPT_MESSAGES.RFQ_NOT_FOUND,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a 404 QUOTE_RFQ_NOT_FOUND to RFQ_NOT_FOUND', async () => {
    stubFetch(404, errorBody('QUOTE_RFQ_NOT_FOUND'), false);
    const r = await getRfqDetail(TOKEN, RFQ_ID);
    expect(r).toEqual({
      status: 'error',
      code: 'RFQ_NOT_FOUND',
      message: ACCEPT_MESSAGES.RFQ_NOT_FOUND,
    });
  });

  it('401 → SESSION_EXPIRED; malformed body → SERVER_ERROR', async () => {
    stubFetch(401, errorBody('whatever'), false);
    expect((await getRfqDetail(TOKEN, RFQ_ID)).status).toBe('error');
    expect(await getRfqDetail(TOKEN, RFQ_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });

    stubFetch(200, { id: RFQ_ID }); // missing required fields
    expect(await getRfqDetail(TOKEN, RFQ_ID)).toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('drops stray/internal wire fields (fail-closed egress)', async () => {
    stubFetch(200, { ...rfqDetailWire, collectorSub: 'sub_leak', internalId: 42 });
    const r = await getRfqDetail(TOKEN, RFQ_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.rfq).not.toHaveProperty('collectorSub');
    expect(r.rfq).not.toHaveProperty('internalId');
  });
});

describe('getMyTrade', () => {
  it('GETs accept/me with no-store and maps a pending trade (incl. registryEventId)', async () => {
    const fetchFn = stubFetch(200, pendingTradeWire);
    const r = await getMyTrade(TOKEN, RFQ_ID);
    expect(r).toEqual({ status: 'success', trade: pendingTrade });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/api/v1/marketplace/rfqs/${RFQ_ID}/accept/me`);
    expect(init.cache).toBe('no-store');
  });

  it('maps a settled trade with txHash + settledAt', async () => {
    stubFetch(200, settledTradeWire);
    const r = await getMyTrade(TOKEN, RFQ_ID);
    if (r.status !== 'success' || !r.trade) throw new Error('expected trade');
    expect(r.trade.status).toBe('settled');
    expect(r.trade.txHash).toBe(settledTradeWire.txHash);
  });

  it('coalesces an unknown failureReason to "unknown" (permissive-in)', async () => {
    stubFetch(200, { ...pendingTradeWire, status: 'failed', failureReason: 'brand_new_reason' });
    const r = await getMyTrade(TOKEN, RFQ_ID);
    if (r.status !== 'success' || !r.trade) throw new Error('expected trade');
    expect(r.trade.failureReason).toBe('unknown');
  });

  it('treats a 204/empty body as trade: null (no trade yet)', async () => {
    stubFetchNoBody(204);
    expect(await getMyTrade(TOKEN, RFQ_ID)).toEqual({ status: 'success', trade: null });
  });

  it('treats a 404 TRADE_NOT_FOUND as trade: null (not an error)', async () => {
    stubFetch(404, errorBody('TRADE_NOT_FOUND'), false);
    expect(await getMyTrade(TOKEN, RFQ_ID)).toEqual({ status: 'success', trade: null });
  });

  it('surfaces other errors', async () => {
    stubFetch(500, errorBody('whatever'), false);
    expect(await getMyTrade(TOKEN, RFQ_ID)).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });
});

describe('prepareAccept', () => {
  it('POSTs accept/prepare with Bearer + Idempotency-Key, body {quoteId}, and maps the envelope', async () => {
    const fetchFn = stubFetch(200, prepareAcceptWire);
    const r = await prepareAccept(TOKEN, RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY);
    expect(r).toEqual({ status: 'success', data: prepareAcceptData });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/api/v1/marketplace/rfqs/${RFQ_ID}/accept/prepare`);
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe(IDEM_KEY);
    expect(JSON.parse(init.body)).toEqual({ quoteId: QUOTE_ID });
  });

  it('parses requiredStroops/availableStroops on ACCEPT_INSUFFICIENT_USDC as strings', async () => {
    stubFetch(422, insufficientUsdcBody, false);
    const r = await prepareAccept(TOKEN, RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY);
    expect(r).toMatchObject({
      status: 'error',
      code: 'ACCEPT_INSUFFICIENT_USDC',
      requiredStroops: GROSS_STROOPS,
      availableStroops: '5000000000',
    });
  });

  it('SEC-1: a non-uuid quoteId short-circuits without a fetch', async () => {
    const fetchFn = stubFetch(200, prepareAcceptWire);
    const r = await prepareAccept(TOKEN, RFQ_ID, { quoteId: 'nope' }, IDEM_KEY);
    expect(r).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('guards a malformed idempotencyKey in the service, without a fetch (todo 181)', async () => {
    const fetchFn = stubFetch(200, prepareAcceptWire);
    const r = await prepareAccept(TOKEN, RFQ_ID, { quoteId: QUOTE_ID }, 'not-a-uuid');
    expect(r).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('degrades an unknown/absent backend error code to the status fallback', async () => {
    stubFetch(500, { message: 'boom' }, false); // no errorCode
    expect(await prepareAccept(TOKEN, RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY)).toMatchObject({
      code: 'SERVER_ERROR',
    });
    stubFetch(401, {}, false);
    expect(await prepareAccept(TOKEN, RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY)).toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('passes through a known ACCEPT_* backend code when present', async () => {
    stubFetch(422, errorBody('ACCEPT_QUOTE_NOT_AUTHORIZED'), false);
    expect(await prepareAccept(TOKEN, RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY)).toMatchObject({
      code: 'ACCEPT_QUOTE_NOT_AUTHORIZED',
    });
  });
});

describe('submitAccept', () => {
  it('POSTs accept with buyerAuthEntryXdr + assertion (no txXdr) and maps the 202', async () => {
    const fetchFn = stubFetch(202, { tradeId: TRADE_ID, status: 'pending' });
    const r = await submitAccept(TOKEN, RFQ_ID, submitAcceptInput, IDEM_KEY);
    expect(r).toEqual({ status: 'success', tradeId: TRADE_ID, tradeStatus: 'pending' });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/api/v1/marketplace/rfqs/${RFQ_ID}/accept`);
    expect(init.headers['Idempotency-Key']).toBe(IDEM_KEY);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      quoteId: QUOTE_ID,
      buyerAuthEntryXdr: submitAcceptInput.buyerAuthEntryXdr,
      authenticatorData: submitAcceptInput.authenticatorData,
      clientDataJSON: submitAcceptInput.clientDataJSON,
      signature: submitAcceptInput.signature,
    });
    expect(body).not.toHaveProperty('txXdr'); // buyerAuthEntryXdr, never a full tx
    expect(body).not.toHaveProperty('credentialId'); // not in the shipped AcceptDto (PR #49)
  });

  it('maps TRADE_ALREADY_IN_FLIGHT (409) through the passthrough classifier', async () => {
    stubFetch(409, errorBody('TRADE_ALREADY_IN_FLIGHT'), false);
    expect(await submitAccept(TOKEN, RFQ_ID, submitAcceptInput, IDEM_KEY)).toMatchObject({
      code: 'TRADE_ALREADY_IN_FLIGHT',
    });
  });

  it('SEC-1: a non-uuid rfqId short-circuits without a fetch', async () => {
    const fetchFn = stubFetch(202, { tradeId: TRADE_ID, status: 'pending' });
    const r = await submitAccept(TOKEN, 'bad', submitAcceptInput, IDEM_KEY);
    expect(r).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
