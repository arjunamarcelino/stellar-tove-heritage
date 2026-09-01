import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubmitAcceptInput } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  getRfqDetail: vi.fn(),
  getMyTrade: vi.fn(),
  prepareAccept: vi.fn(),
  submitAccept: vi.fn(),
  readAccessToken: vi.fn(),
}));

vi.mock('@/lib/services/accept', () => ({
  getRfqDetail: h.getRfqDetail,
  getMyTrade: h.getMyTrade,
  prepareAccept: h.prepareAccept,
  submitAccept: h.submitAccept,
}));
vi.mock('@/lib/cookies', () => ({ readAccessToken: h.readAccessToken }));

import {
  rfqDetailAction,
  prepareAcceptAction,
  submitAcceptAction,
  pollMyTradeAction,
} from '@/app/actions/accept';

const RFQ_ID = '4f900000-0000-4000-8000-000000000001';
const QUOTE_ID = '6c700000-0000-4000-8000-000000000001';
const IDEM_KEY = '11111111-1111-4111-8111-111111111111';
const submit: SubmitAcceptInput = {
  quoteId: QUOTE_ID,
  buyerAuthEntryXdr: 'entry',
  authenticatorData: 'ad',
  clientDataJSON: 'cd',
  signature: 'sig',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.readAccessToken.mockResolvedValue('tok');
});

describe('rfqDetailAction', () => {
  it('SESSION_EXPIRED + no service call without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await rfqDetailAction(RFQ_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.getRfqDetail).not.toHaveBeenCalled();
  });

  it('RFQ_NOT_FOUND on a non-uuid rfqId, no service call', async () => {
    expect(await rfqDetailAction('bad')).toMatchObject({ code: 'RFQ_NOT_FOUND' });
    expect(h.getRfqDetail).not.toHaveBeenCalled();
  });

  it('delegates verbatim on the happy path', async () => {
    const result = { status: 'success' as const, rfq: {} };
    h.getRfqDetail.mockResolvedValue(result);
    expect(await rfqDetailAction(RFQ_ID)).toBe(result);
    expect(h.getRfqDetail).toHaveBeenCalledWith('tok', RFQ_ID);
  });
});

describe('prepareAcceptAction', () => {
  it('SESSION_EXPIRED + no service call without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await prepareAcceptAction(RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY)).toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(h.prepareAccept).not.toHaveBeenCalled();
  });

  it('SERVER_ERROR on a non-uuid quoteId / non-object input (shape guard), no service call', async () => {
    expect(await prepareAcceptAction(RFQ_ID, { quoteId: 'nope' }, IDEM_KEY)).toMatchObject({
      code: 'SERVER_ERROR',
    });
    // @ts-expect-error — deliberately passing a non-object to exercise the shape guard
    expect(await prepareAcceptAction(RFQ_ID, null, IDEM_KEY)).toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(h.prepareAccept).not.toHaveBeenCalled();
  });

  it('SERVER_ERROR on a malformed idempotency key, no service call', async () => {
    expect(await prepareAcceptAction(RFQ_ID, { quoteId: QUOTE_ID }, 'not-a-uuid')).toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(h.prepareAccept).not.toHaveBeenCalled();
  });

  it('delegates verbatim on the happy path', async () => {
    const result = { status: 'success' as const, data: {} };
    h.prepareAccept.mockResolvedValue(result);
    expect(await prepareAcceptAction(RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY)).toBe(result);
    expect(h.prepareAccept).toHaveBeenCalledWith('tok', RFQ_ID, { quoteId: QUOTE_ID }, IDEM_KEY);
  });
});

describe('submitAcceptAction', () => {
  it('SERVER_ERROR when an assertion field is missing, no service call', async () => {
    expect(await submitAcceptAction(RFQ_ID, { ...submit, signature: '' }, IDEM_KEY)).toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(h.submitAccept).not.toHaveBeenCalled();
  });

  it('delegates verbatim on the happy path', async () => {
    const result = { status: 'success' as const, tradeId: 't', tradeStatus: 'pending' as const };
    h.submitAccept.mockResolvedValue(result);
    expect(await submitAcceptAction(RFQ_ID, submit, IDEM_KEY)).toBe(result);
    expect(h.submitAccept).toHaveBeenCalledWith('tok', RFQ_ID, submit, IDEM_KEY);
  });
});

describe('pollMyTradeAction', () => {
  it('SESSION_EXPIRED + no service call without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await pollMyTradeAction(RFQ_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.getMyTrade).not.toHaveBeenCalled();
  });

  it('delegates verbatim on the happy path', async () => {
    const result = { status: 'success' as const, trade: null };
    h.getMyTrade.mockResolvedValue(result);
    expect(await pollMyTradeAction(RFQ_ID)).toBe(result);
    expect(h.getMyTrade).toHaveBeenCalledWith('tok', RFQ_ID);
  });
});
