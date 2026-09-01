// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { get: apiGet, post: apiPost } }));

import { approveOffering, getOffering, getOfferings } from './api';

const listItem = {
  id: 'o1',
  artworkId: 'a1',
  status: 'planned',
  lowPriceStroops: '1000000',
  highPriceStroops: '5000000',
  publicFloat: '800000',
  windowOpenAt: '2026-09-01T00:00:00.000Z',
  windowCloseAt: '2026-09-08T00:00:00.000Z',
  attestedArtistAddress: null,
  escrow: { deployStatus: null, contractAddress: null },
  approvals: { count: 0, threshold: 2, youApproved: false },
};

const detail = {
  ...listItem,
  escrow: { deployStatus: null, contractAddress: null, deployLedger: null, approvedAt: null },
  approvals: { count: 0, threshold: 2, signers: [] },
};

describe('getOfferings', () => {
  beforeEach(() => apiGet.mockReset());

  it('builds the query string and parses the envelope (positive)', async () => {
    apiGet.mockResolvedValueOnce({ data: [listItem], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    const res = await getOfferings({ status: 'planned', page: 1, limit: 20 });
    expect(res.data).toHaveLength(1);
    expect(apiGet).toHaveBeenCalledWith('/api/offerings?page=1&limit=20&status=planned');
  });

  it('omits the query string when no params (edge)', async () => {
    apiGet.mockResolvedValueOnce({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    await getOfferings();
    expect(apiGet).toHaveBeenCalledWith('/api/offerings');
  });
});

describe('getOffering', () => {
  beforeEach(() => apiGet.mockReset());

  it('parses detail and preserves a > 2^53 i128 string byte-for-byte (edge)', async () => {
    const big = '170141183460469231731687303715884105727';
    apiGet.mockResolvedValueOnce({ ...detail, highPriceStroops: big });
    const res = await getOffering('o1');
    expect(res.highPriceStroops).toBe(big);
    expect(apiGet).toHaveBeenCalledWith('/api/offerings/o1');
  });
});

describe('approveOffering', () => {
  beforeEach(() => apiPost.mockReset());

  it('POSTs an empty body with the idempotency key and parses the 202 (positive)', async () => {
    apiPost.mockResolvedValueOnce({
      offeringId: 'o1',
      status: 'planned',
      approvals: { count: 1, threshold: 2, youApproved: true, signers: ['sub1'] },
      escrow: { deployStatus: null, contractAddress: null },
    });
    const res = await approveOffering('o1', 'key-1234-5678');
    expect(res.approvals.youApproved).toBe(true);
    expect(apiPost).toHaveBeenCalledWith('/api/offerings/o1/approve', {}, { idempotencyKey: 'key-1234-5678' });
  });

  it('parses a quorum-reaching 202 with escrow deploying (edge)', async () => {
    apiPost.mockResolvedValueOnce({
      offeringId: 'o1',
      status: 'planned',
      approvals: { count: 2, threshold: 2, youApproved: true, signers: ['sub1', 'sub2'] },
      escrow: { deployStatus: 'deploying', contractAddress: null },
    });
    const res = await approveOffering('o1', 'key-1234-5678');
    expect(res.escrow.deployStatus).toBe('deploying');
  });
});
