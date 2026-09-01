import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ARTWORK_ID, IDEM_KEY, rfqInput, rfq } from '@/test/fixtures/rfq';

const h = vi.hoisted(() => ({
  createRfq: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/rfqs', () => ({ createRfq: h.createRfq }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import { createRfqAction } from '@/app/actions/rfqs';

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' });
});

describe('createRfqAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await createRfqAction(ARTWORK_ID, rfqInput, IDEM_KEY)).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
    expect(h.createRfq).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid artworkId as ARTWORK_NOT_FOUND without calling the service (SEC-1)', async () => {
    expect(await createRfqAction('not-a-uuid', rfqInput, IDEM_KEY)).toMatchObject({
      status: 'error',
      code: 'ARTWORK_NOT_FOUND',
    });
    expect(h.createRfq).not.toHaveBeenCalled();
  });

  it('rejects a malformed idempotency key as SERVER_ERROR', async () => {
    expect(await createRfqAction(ARTWORK_ID, rfqInput, 'bad-key')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
    expect(h.createRfq).not.toHaveBeenCalled();
  });

  it('rejects a zero / oversized price as RFQ_INVALID_PRICE before the service', async () => {
    expect(
      await createRfqAction(ARTWORK_ID, { ...rfqInput, maxPricePerFractionStroops: '0' }, IDEM_KEY),
    ).toMatchObject({ status: 'error', code: 'RFQ_INVALID_PRICE' });
    expect(
      await createRfqAction(
        ARTWORK_ID,
        { ...rfqInput, maxPricePerFractionStroops: '79228162514264337593543950336' },
        IDEM_KEY,
      ),
    ).toMatchObject({ status: 'error', code: 'RFQ_INVALID_PRICE' });
    expect(h.createRfq).not.toHaveBeenCalled();
  });

  it('rejects a < 1 / non-integer count and a non-preset expiry as VALIDATION_FAILED', async () => {
    expect(
      await createRfqAction(ARTWORK_ID, { ...rfqInput, fractionCount: 0 }, IDEM_KEY),
    ).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(
      await createRfqAction(ARTWORK_ID, { ...rfqInput, fractionCount: 1.5 }, IDEM_KEY),
    ).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(
      await createRfqAction(ARTWORK_ID, { ...rfqInput, expiryHours: 5 as 24 }, IDEM_KEY),
    ).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.createRfq).not.toHaveBeenCalled();
  });

  it('rejects price × count > i128 as RFQ_AMOUNT_OVERFLOW before the service', async () => {
    expect(
      await createRfqAction(
        ARTWORK_ID,
        {
          fractionCount: 9_000_000_000_000_000,
          maxPricePerFractionStroops: '79228162514264337593543950335',
          expiryHours: 48,
        },
        IDEM_KEY,
      ),
    ).toMatchObject({ status: 'error', code: 'RFQ_AMOUNT_OVERFLOW' });
    expect(h.createRfq).not.toHaveBeenCalled();
  });

  it('delegates valid input to createRfq with exact args and returns the result verbatim', async () => {
    const result = { status: 'success' as const, rfq };
    h.createRfq.mockResolvedValue(result);
    const returned = await createRfqAction(ARTWORK_ID, rfqInput, IDEM_KEY);
    expect(h.createRfq).toHaveBeenCalledWith('tok', ARTWORK_ID, rfqInput, IDEM_KEY);
    expect(returned).toBe(result); // verbatim
  });
});
