import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  updateTag: h.updateTag,
  unstable_cache: (fn: unknown) => fn,
}));

import { revalidateTrustlineStatus } from '@/app/actions/trustline';

const G = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';

beforeEach(() => vi.clearAllMocks());

describe('revalidateTrustlineStatus', () => {
  it('busts the per-address trustline tag for a valid strkey', async () => {
    await revalidateTrustlineStatus(G);
    expect(h.updateTag).toHaveBeenCalledWith(`trustline:${G}`);
  });

  it('does nothing for a malformed address (never revalidates an unvalidated tag)', async () => {
    await revalidateTrustlineStatus('not-a-key');
    expect(h.updateTag).not.toHaveBeenCalled();
  });
});
