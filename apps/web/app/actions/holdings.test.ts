import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getHoldings: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/holdings', () => ({ getHoldings: h.getHoldings }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import { refreshHoldingsAction } from '@/app/actions/holdings';

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' }); // authenticated by default
});

describe('refreshHoldingsAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await refreshHoldingsAction()).toMatchObject({ status: 'error', code: 'SESSION_EXPIRED' });
    expect(h.getHoldings).not.toHaveBeenCalled();
  });

  it('delegates to getHoldings with the cookie token and returns its result verbatim', async () => {
    const result = { status: 'success', holdings: [] };
    h.getHoldings.mockResolvedValue(result);
    expect(await refreshHoldingsAction()).toBe(result);
    expect(h.getHoldings).toHaveBeenCalledWith('tok');
  });
});
