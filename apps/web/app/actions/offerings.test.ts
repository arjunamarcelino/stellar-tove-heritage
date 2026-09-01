import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BidInput, SubmitBidInput } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  prepareBid: vi.fn(),
  submitBid: vi.fn(),
  getMyBid: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/offerings', () => ({
  prepareBid: h.prepareBid,
  submitBid: h.submitBid,
  getMyBid: h.getMyBid,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import { prepareBidAction, submitBidAction, refreshMyBidAction } from '@/app/actions/offerings';

const OFFERING_ID = '0ff30000-0000-4000-8000-000000000001';
const IDEM_KEY = '11111111-1111-4111-8111-111111111111';
const input: BidInput = { price: '100000000', count: 10 };
const submit: SubmitBidInput = {
  txXdr: 'AAAA',
  credentialId: 'cred',
  authenticatorData: 'ad',
  clientDataJSON: 'cd',
  signature: 'sig',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' });
});

describe('prepareBidAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await prepareBidAction(OFFERING_ID, input, IDEM_KEY)).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
    expect(h.prepareBid).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid offeringId as OFFERING_NOT_FOUND without fetching (SEC-1)', async () => {
    expect(await prepareBidAction('not-a-uuid', input, IDEM_KEY)).toMatchObject({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
    });
    expect(h.prepareBid).not.toHaveBeenCalled();
  });

  it('rejects a malformed idempotency key as SERVER_ERROR', async () => {
    expect(await prepareBidAction(OFFERING_ID, input, 'bad-key')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
    expect(h.prepareBid).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric price / zero count / overflowing amount (SEC-3)', async () => {
    expect(
      await prepareBidAction(OFFERING_ID, { price: '1.5', count: 10 }, IDEM_KEY),
    ).toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(await prepareBidAction(OFFERING_ID, { price: '100', count: 0 }, IDEM_KEY)).toMatchObject(
      {
        code: 'SERVER_ERROR',
      },
    );
    const huge = '170141183460469231731687303715884105727'; // i128 max; × 2 overflows
    expect(await prepareBidAction(OFFERING_ID, { price: huge, count: 2 }, IDEM_KEY)).toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(h.prepareBid).not.toHaveBeenCalled();
  });

  it('delegates to prepareBid with the token, id, input and key; returns verbatim', async () => {
    const result = { status: 'success', data: {} };
    h.prepareBid.mockResolvedValue(result);
    expect(await prepareBidAction(OFFERING_ID, input, IDEM_KEY)).toBe(result);
    expect(h.prepareBid).toHaveBeenCalledWith('tok', OFFERING_ID, input, IDEM_KEY);
  });
});

describe('submitBidAction', () => {
  it('returns SESSION_EXPIRED without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await submitBidAction(OFFERING_ID, submit, IDEM_KEY)).toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(h.submitBid).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid offeringId as OFFERING_NOT_FOUND', async () => {
    expect(await submitBidAction('nope', submit, IDEM_KEY)).toMatchObject({
      code: 'OFFERING_NOT_FOUND',
    });
    expect(h.submitBid).not.toHaveBeenCalled();
  });

  it('rejects a submit body missing assertion material as SERVER_ERROR', async () => {
    expect(
      await submitBidAction(OFFERING_ID, { ...submit, signature: '' }, IDEM_KEY),
    ).toMatchObject({ code: 'SERVER_ERROR' });
    expect(h.submitBid).not.toHaveBeenCalled();
  });

  it('delegates to submitBid with the same key; returns verbatim', async () => {
    const result = { status: 'success', bid: {} };
    h.submitBid.mockResolvedValue(result);
    expect(await submitBidAction(OFFERING_ID, submit, IDEM_KEY)).toBe(result);
    expect(h.submitBid).toHaveBeenCalledWith('tok', OFFERING_ID, submit, IDEM_KEY);
  });
});

describe('refreshMyBidAction', () => {
  it('returns SESSION_EXPIRED without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await refreshMyBidAction(OFFERING_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.getMyBid).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid offeringId as OFFERING_NOT_FOUND', async () => {
    expect(await refreshMyBidAction('nope')).toMatchObject({ code: 'OFFERING_NOT_FOUND' });
    expect(h.getMyBid).not.toHaveBeenCalled();
  });

  it('delegates to getMyBid with the cookie token and offering id; returns verbatim', async () => {
    const result = { status: 'success', bid: null };
    h.getMyBid.mockResolvedValue(result);
    expect(await refreshMyBidAction(OFFERING_ID)).toBe(result);
    expect(h.getMyBid).toHaveBeenCalledWith('tok', OFFERING_ID);
  });
});
