import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getOffering,
  getActiveOffering,
  prepareBid,
  submitBid,
  getMyBid,
} from '@/lib/services/offerings';
import { OFFERINGS_MESSAGES } from '@/lib/offerings/offeringsMessages';
import { OFFERING_REVALIDATE_S } from '@/lib/offerings/constants';
import {
  OFFERING_ID,
  ARTWORK_ID,
  offeringWire,
  offering,
  prepareWire,
  prepareData,
  bidWire,
  submittedBid,
  submitInput,
} from '@/test/fixtures/offerings';
import type { BidBackendErrorCode, BidInput } from '@/lib/types/api';

const OLD_ENV = process.env;
const BID_INPUT: BidInput = { price: '100000000', count: 10 };

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

describe('getOffering', () => {
  it('GETs the public offering with NO Bearer header, a next cache opt, and parses the wire shape', async () => {
    const fetchFn = stubFetch(200, offeringWire);
    const result = await getOffering(OFFERING_ID);
    expect(result).toEqual({ status: 'success', offering });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/offerings/${OFFERING_ID}`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBeUndefined(); // tokenless public read
    expect(init.next).toEqual({
      revalidate: OFFERING_REVALIDATE_S,
      tags: [`offering:${OFFERING_ID}`],
    });
    expect(init.cache).toBeUndefined();
  });

  it('parses the const-tuple status enum and keeps amounts as strings (never NaN)', async () => {
    stubFetch(200, { ...offeringWire, status: 'subscribed', lowPriceStroops: '9007199254740993' });
    const r = await getOffering(OFFERING_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.offering.status).toBe('subscribed');
    expect(r.offering.lowPriceStroops).toBe('9007199254740993');
  });

  it('rejects an unknown status enum → SERVER_ERROR', async () => {
    stubFetch(200, { ...offeringWire, status: 'closed' });
    expect(await getOffering(OFFERING_ID)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('SEC-1: rejects an invalid (non-uuid) id → OFFERING_NOT_FOUND without fetching', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await getOffering('../../etc/passwd')).toEqual({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a codeless 404 → OFFERING_NOT_FOUND (its only 404 meaning, SEC-2)', async () => {
    stubFetch(404, {});
    expect(await getOffering(OFFERING_ID)).toMatchObject({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
    });
  });

  it('maps 429→RATE_LIMITED, 0→NETWORK_ERROR, 5xx→SERVER_ERROR (never SESSION_EXPIRED — tokenless)', async () => {
    stubFetch(429, {});
    expect(await getOffering(OFFERING_ID)).toMatchObject({ status: 'error', code: 'RATE_LIMITED' });

    stubFetch(401, {}); // even a 401 on the tokenless read folds to SERVER_ERROR (no SESSION_EXPIRED)
    expect(await getOffering(OFFERING_ID)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });

    stubFetch(503, {});
    expect(await getOffering(OFFERING_ID)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getOffering(OFFERING_ID)).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });

  it('malformed body (missing critical key) → SERVER_ERROR', async () => {
    const { windowCloseAt: _drop, ...missing } = offeringWire;
    void _drop;
    stubFetch(200, missing);
    expect(await getOffering(OFFERING_ID)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('strips unknown wire keys (egress allow-list)', async () => {
    stubFetch(200, { ...offeringWire, internalNote: 'secret', adminId: 'x' });
    const r = await getOffering(OFFERING_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.offering).not.toHaveProperty('internalNote');
    expect(r.offering).not.toHaveProperty('adminId');
  });
});

describe('getActiveOffering', () => {
  it('reads the embedded activeOffering (OPEN DEP #2) and maps it', async () => {
    const fetchFn = stubFetch(200, { activeOffering: offeringWire });
    const result = await getActiveOffering(ARTWORK_ID);
    expect(result).toEqual({ status: 'success', offering });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/artworks/${ARTWORK_ID}`);
    expect(init.next).toEqual({
      revalidate: OFFERING_REVALIDATE_S,
      tags: [`artwork-offering:${ARTWORK_ID}`],
    });
  });

  it('a null/absent activeOffering → OFFERING_NOT_FOUND', async () => {
    stubFetch(200, { activeOffering: null });
    expect(await getActiveOffering(ARTWORK_ID)).toMatchObject({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
    });
    stubFetch(200, {});
    expect(await getActiveOffering(ARTWORK_ID)).toMatchObject({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
    });
  });

  it('a present-but-malformed embed → SERVER_ERROR (drift, not "no offering")', async () => {
    stubFetch(200, { activeOffering: { ...offeringWire, lowPriceStroops: 'not-a-number' } });
    expect(await getActiveOffering(ARTWORK_ID)).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('SEC-1: invalid artworkId → OFFERING_NOT_FOUND without fetching', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await getActiveOffering('bad')).toMatchObject({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('prepareBid', () => {
  it('POSTs {price,count} with Bearer + Idempotency-Key headers and returns the prepare envelope', async () => {
    const fetchFn = stubFetch(200, prepareWire);
    const result = await prepareBid('tok', OFFERING_ID, BID_INPUT, 'idem-1');
    expect(result).toEqual({ status: 'success', data: prepareData });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/offerings/${OFFERING_ID}/bids/prepare`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Idempotency-Key']).toBe('idem-1');
    expect(JSON.parse(init.body)).toEqual({ price: '100000000', count: 10 });
  });

  it('is a spread-free allow-list — strips any extra prepare-response field (AC-10)', async () => {
    stubFetch(200, { ...prepareWire, secretSeed: 'LEAK', internal: 1 });
    const r = await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k');
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.data).not.toHaveProperty('secretSeed');
    expect(r.data).not.toHaveProperty('internal');
    expect(Object.keys(r.data).sort()).toEqual([
      'challenge',
      'credentialId',
      'escrowAmountStroops',
      'expiresAtLedger',
      'rpId',
      'transports',
      'txXdr',
    ]);
  });

  const BID_BACKEND_CODES: BidBackendErrorCode[] = [
    'BID_INSUFFICIENT_BALANCE',
    'BID_BELOW_LOW_PRICE',
    'BID_ABOVE_HIGH_PRICE',
    'BID_COUNT_EXCEEDS_FLOAT',
    'OFFERING_WINDOW_NOT_OPEN',
    'OFFERING_WINDOW_CLOSED',
    'OFFERING_NOT_OPEN',
    'BID_ALREADY_ACTIVE',
    'IDEMPOTENCY_KEY_IN_FLIGHT',
    'IDEMPOTENCY_KEY_MISMATCH',
    'BID_CHALLENGE_EXPIRED',
    'BID_NOT_WHITELISTED',
    'WALLET_NOT_FOUND',
    'OFFERING_NOT_FOUND',
  ];

  it('passes through every BidBackendErrorCode verbatim (classifier exhaustiveness — 14 codes)', async () => {
    expect(BID_BACKEND_CODES).toHaveLength(14);
    for (const code of BID_BACKEND_CODES) {
      // status 422 is irrelevant — the backend errorCode is authoritative for a passthrough code.
      stubFetch(422, { errorCode: code, message: 'raw diagnostic that must never surface' });
      const r = await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k');
      expect(r).toMatchObject({ status: 'error', code });
      // message is always the curated copy, never the raw backend message.
      expect(r.status === 'error' && r.message).toBe(OFFERINGS_MESSAGES[code]);
    }
  });

  it('BID_INSUFFICIENT_BALANCE additionally extracts Zod-validated required/available', async () => {
    stubFetch(422, {
      errorCode: 'BID_INSUFFICIENT_BALANCE',
      requiredStroops: '1000000000',
      availableStroops: '500000000',
    });
    expect(await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k')).toEqual({
      status: 'error',
      code: 'BID_INSUFFICIENT_BALANCE',
      message: OFFERINGS_MESSAGES.BID_INSUFFICIENT_BALANCE,
      required: '1000000000',
      available: '500000000',
    });
  });

  it('BID_INSUFFICIENT_BALANCE without a valid detail body omits required/available (generic copy)', async () => {
    stubFetch(422, { errorCode: 'BID_INSUFFICIENT_BALANCE', requiredStroops: 'oops' });
    const r = await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k');
    expect(r).toEqual({
      status: 'error',
      code: 'BID_INSUFFICIENT_BALANCE',
      message: OFFERINGS_MESSAGES.BID_INSUFFICIENT_BALANCE,
    });
    expect(r).not.toHaveProperty('required');
  });

  it('a codeless 409 / codeless 404 → SERVER_ERROR (SEC-2: never guessed to WALLET_NOT_FOUND)', async () => {
    stubFetch(409, {});
    expect(await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
    stubFetch(404, {});
    expect(await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('maps transport statuses: 401→SESSION_EXPIRED, 429→RATE_LIMITED, 0→NETWORK_ERROR', async () => {
    stubFetch(401, {});
    expect(await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k')).toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    stubFetch(429, {});
    expect(await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k')).toMatchObject({
      code: 'RATE_LIMITED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    expect(await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k')).toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('SEC-1: invalid offeringId → OFFERING_NOT_FOUND without fetching', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await prepareBid('tok', 'not-a-uuid', BID_INPUT, 'k')).toMatchObject({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a 200 with a malformed prepare body → SERVER_ERROR', async () => {
    stubFetch(200, { ...prepareWire, escrowAmountStroops: 'NaN' });
    expect(await prepareBid('tok', OFFERING_ID, BID_INPUT, 'k')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });
});

describe('submitBid', () => {
  it('POSTs the 5 fields with Bearer + Idempotency-Key and returns the Bid on 201', async () => {
    const fetchFn = stubFetch(201, bidWire);
    const result = await submitBid('tok', OFFERING_ID, submitInput, 'idem-1');
    expect(result).toEqual({ status: 'success', bid: submittedBid });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/offerings/${OFFERING_ID}/bids`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Idempotency-Key']).toBe('idem-1');
    expect(JSON.parse(init.body)).toEqual({
      txXdr: submitInput.txXdr,
      credentialId: submitInput.credentialId,
      authenticatorData: submitInput.authenticatorData,
      clientDataJSON: submitInput.clientDataJSON,
      signature: submitInput.signature,
    });
  });

  it('BID_CHALLENGE_EXPIRED (422) passes through; a codeless 409 → SERVER_ERROR', async () => {
    stubFetch(422, { errorCode: 'BID_CHALLENGE_EXPIRED' });
    expect(await submitBid('tok', OFFERING_ID, submitInput, 'k')).toMatchObject({
      status: 'error',
      code: 'BID_CHALLENGE_EXPIRED',
    });
    stubFetch(409, {});
    expect(await submitBid('tok', OFFERING_ID, submitInput, 'k')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('a 201 with a malformed bid body → SERVER_ERROR', async () => {
    stubFetch(201, { ...bidWire, count: '10' }); // count must be a number
    expect(await submitBid('tok', OFFERING_ID, submitInput, 'k')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('SEC-1: invalid offeringId → OFFERING_NOT_FOUND without fetching', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await submitBid('tok', 'nope', submitInput, 'k')).toMatchObject({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('getMyBid', () => {
  it('GETs bids/me with a Bearer header + cache:no-store and parses a Bid body', async () => {
    const fetchFn = stubFetch(200, bidWire);
    const result = await getMyBid('tok', OFFERING_ID);
    expect(result).toEqual({ status: 'success', bid: submittedBid });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/offerings/${OFFERING_ID}/bids/me`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-store');
    expect(init.next).toBeUndefined();
  });

  it('a 200/204 empty body (data null) → { bid: null } (no active bid, not an error)', async () => {
    stubFetch(204, null);
    expect(await getMyBid('tok', OFFERING_ID)).toEqual({ status: 'success', bid: null });
    stubFetch(200, null);
    expect(await getMyBid('tok', OFFERING_ID)).toEqual({ status: 'success', bid: null });
  });

  it('a 404 WALLET_NOT_FOUND STAYS in the error path (must not masquerade as bid:null)', async () => {
    stubFetch(404, { errorCode: 'WALLET_NOT_FOUND' });
    expect(await getMyBid('tok', OFFERING_ID)).toEqual({
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: OFFERINGS_MESSAGES.WALLET_NOT_FOUND,
    });
  });

  it('a codeless 404 → SERVER_ERROR (never guessed to WALLET_NOT_FOUND, SEC-2)', async () => {
    stubFetch(404, {});
    expect(await getMyBid('tok', OFFERING_ID)).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('a malformed non-empty body → SERVER_ERROR (never silently bid:null)', async () => {
    stubFetch(200, { id: 'b1', status: 'submitted' }); // missing critical keys
    expect(await getMyBid('tok', OFFERING_ID)).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('a 401 → SESSION_EXPIRED', async () => {
    stubFetch(401, {});
    expect(await getMyBid('tok', OFFERING_ID)).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
  });
});
