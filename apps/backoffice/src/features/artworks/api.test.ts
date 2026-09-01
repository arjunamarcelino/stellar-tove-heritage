// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { post: apiPost, get: vi.fn() } }));

import { fractionalizeArtwork } from './api';

const validData = {
  totalSupply: 100,
  artistRetentionPct: 10,
  treasuryRetentionPct: 5,
  artistLockupDays: 365,
  treasuryLockupDays: 730,
  name: 'Northern Lights',
  symbol: 'NLIGHT',
};

describe('fractionalizeArtwork', () => {
  it('parses the 202 accepted body into a FractionalizationStatus and forwards the key (080)', async () => {
    apiPost.mockResolvedValueOnce({
      artworkId: 'a1',
      fractionContractId: 'f1',
      status: 'deploying',
      tokenAddress: null,
    });
    const res = await fractionalizeArtwork('a1', validData, 'key-12345678');
    expect(res.status).toBe('deploying');
    expect(res.tokenAddress).toBeNull();
    expect(apiPost).toHaveBeenCalledWith('/api/artworks/a1/fractionalize', validData, {
      idempotencyKey: 'key-12345678',
    });
  });

  it('rejects a malformed 202 body (missing required fields)', async () => {
    apiPost.mockResolvedValueOnce({ status: 'deploying' });
    await expect(fractionalizeArtwork('a1', validData, 'key-12345678')).rejects.toBeTruthy();
  });
});
