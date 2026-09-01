import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RFQ_ID, IDEM_KEY, quoteInput, quote } from '@/test/fixtures/quote';

// The action reads the token via lib/cookies (server-only) — stub it so the module loads in the test.
vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  submitQuote: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/quotes', () => ({ submitQuote: h.submitQuote }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import { submitQuoteAction } from '@/app/actions/quotes';

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' });
});

describe('submitQuoteAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await submitQuoteAction(RFQ_ID, quoteInput, IDEM_KEY)).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
    expect(h.submitQuote).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid rfqId as QUOTE_RFQ_NOT_FOUND without calling the service (SEC-1)', async () => {
    expect(await submitQuoteAction('not-a-uuid', quoteInput, IDEM_KEY)).toMatchObject({
      status: 'error',
      code: 'QUOTE_RFQ_NOT_FOUND',
    });
    expect(h.submitQuote).not.toHaveBeenCalled();
  });

  it('rejects a malformed idempotency key as SERVER_ERROR', async () => {
    expect(await submitQuoteAction(RFQ_ID, quoteInput, 'bad-key')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
    expect(h.submitQuote).not.toHaveBeenCalled();
  });

  // Bounds (price/count/validUntil/shape) are the SERVICE's job now (checkQuoteBounds, the single trust
  // boundary before the network) — the action delegates them rather than re-checking. See quotes.test.ts +
  // validation.test.ts for the bounds coverage.
  it('delegates bounds-checking to the service (a zero-price input is passed through, not pre-rejected)', async () => {
    const result = { status: 'error' as const, code: 'QUOTE_INVALID_PRICE' as const, message: 'x' };
    h.submitQuote.mockResolvedValue(result);
    const bad = { ...quoteInput, pricePerFractionStroops: '0' };
    expect(await submitQuoteAction(RFQ_ID, bad, IDEM_KEY)).toBe(result);
    expect(h.submitQuote).toHaveBeenCalledWith('tok', RFQ_ID, bad, IDEM_KEY);
  });

  it('C1: passes a past-but-well-formed validUntil through to the service (server owns the > now check)', async () => {
    const result = { status: 'success' as const, quote };
    h.submitQuote.mockResolvedValue(result);
    const input = { ...quoteInput, validUntil: '2020-01-01T00:00:00.000Z' };
    await submitQuoteAction(RFQ_ID, input, IDEM_KEY);
    expect(h.submitQuote).toHaveBeenCalledWith('tok', RFQ_ID, input, IDEM_KEY);
  });

  it('delegates valid input to submitQuote with exact args and returns the result verbatim', async () => {
    const result = { status: 'success' as const, quote };
    h.submitQuote.mockResolvedValue(result);
    const returned = await submitQuoteAction(RFQ_ID, quoteInput, IDEM_KEY);
    expect(h.submitQuote).toHaveBeenCalledWith('tok', RFQ_ID, quoteInput, IDEM_KEY);
    expect(returned).toBe(result); // verbatim
  });
});
