// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ApiError } from '@/types/api';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { get: apiGet, post: apiPost } }));

import { getWalletStatus, submitAllowlistAction } from './api';

const WALLET = 'C' + 'A'.repeat(55);

describe('getWalletStatus', () => {
  beforeEach(() => apiGet.mockReset());

  it('maps 200 { isAllowed: true } → whitelisted (positive)', async () => {
    apiGet.mockResolvedValueOnce({ wallet: WALLET, isAllowed: true });
    await expect(getWalletStatus(WALLET)).resolves.toEqual({ status: 'whitelisted', wallet: WALLET });
    expect(apiGet).toHaveBeenCalledWith(`/api/kyc/allowlist/${WALLET}`);
  });

  it('maps 200 { isAllowed: false } → not-listed (positive)', async () => {
    apiGet.mockResolvedValueOnce({ wallet: WALLET, isAllowed: false });
    await expect(getWalletStatus(WALLET)).resolves.toEqual({ status: 'not-listed', wallet: WALLET });
  });

  it('degrades 404/5xx/429/network to unknown, does not throw (edge)', async () => {
    for (const err of [
      new ApiError('nf', 404, 'NOT_FOUND'),
      new ApiError('boom', 500, 'UPSTREAM_ERROR'),
      new ApiError('slow down', 429, 'RATE_LIMITED'),
      new TypeError('Failed to fetch'),
    ]) {
      apiGet.mockRejectedValueOnce(err);
      await expect(getWalletStatus(WALLET)).resolves.toEqual({ status: 'unknown', wallet: WALLET });
    }
  });

  it('rethrows 401/403 (negative)', async () => {
    apiGet.mockRejectedValueOnce(new ApiError('unauth', 401, 'UNAUTHENTICATED'));
    await expect(getWalletStatus(WALLET)).rejects.toBeInstanceOf(ApiError);
    apiGet.mockRejectedValueOnce(new ApiError('forbidden', 403, 'FORBIDDEN'));
    await expect(getWalletStatus(WALLET)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('submitAllowlistAction', () => {
  beforeEach(() => apiPost.mockReset());

  const confirmed = {
    wallet: WALLET,
    action: 'add',
    status: 'confirmed',
    isAllowed: true,
    txHash: 'a'.repeat(64),
    errorReason: null,
  };

  it('POSTs a batch-of-one with the idempotency key and returns results[0] (positive)', async () => {
    apiPost.mockResolvedValueOnce({ results: [confirmed] });
    const res = await submitAllowlistAction({ wallet: WALLET, action: 'add' }, 'key-12345678');
    expect(res.status).toBe('confirmed');
    expect(apiPost).toHaveBeenCalledWith(
      '/api/kyc/allowlist',
      { items: [{ wallet: WALLET, action: 'add' }] },
      { idempotencyKey: 'key-12345678' },
    );
  });

  it('includes reason when set, omits it when blank (edge)', async () => {
    apiPost.mockResolvedValue({ results: [confirmed] });
    await submitAllowlistAction({ wallet: WALLET, action: 'add', reason: 'kyc_passed' }, 'k-12345678');
    expect(apiPost.mock.calls[0]?.[1]).toEqual({
      items: [{ wallet: WALLET, action: 'add', reason: 'kyc_passed' }],
    });
    await submitAllowlistAction({ wallet: WALLET, action: 'add', reason: undefined }, 'k-12345678');
    expect(apiPost.mock.calls[1]?.[1]).toEqual({ items: [{ wallet: WALLET, action: 'add' }] });
  });

  it('throws EMPTY_ALLOWLIST_RESULT when results is empty (negative)', async () => {
    apiPost.mockResolvedValueOnce({ results: [] });
    await expect(
      submitAllowlistAction({ wallet: WALLET, action: 'add' }, 'key-12345678'),
    ).rejects.toMatchObject({ code: 'EMPTY_ALLOWLIST_RESULT' });
  });
});
