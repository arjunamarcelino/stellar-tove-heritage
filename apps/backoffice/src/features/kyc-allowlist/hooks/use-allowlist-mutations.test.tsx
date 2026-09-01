import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { allowlistKeys } from '@/lib/query-keys';
import { ApiError } from '@/types/api';

const { submitAllowlistAction } = vi.hoisted(() => ({ submitAllowlistAction: vi.fn() }));
vi.mock('../api', () => ({ submitAllowlistAction }));

import { useAllowlistAction } from './use-allowlist-mutations';

const WALLET = 'C' + 'A'.repeat(55);

const confirmed = {
  wallet: WALLET,
  action: 'add' as const,
  status: 'confirmed' as const,
  isAllowed: true,
  txHash: 'a'.repeat(64),
  errorReason: null,
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

describe('useAllowlistAction', () => {
  beforeEach(() => submitAllowlistAction.mockReset());

  it('confirmed → setQueryData from response, NO invalidate (positive)', async () => {
    submitAllowlistAction.mockResolvedValueOnce(confirmed);
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAllowlistAction(WALLET), { wrapper: Wrapper });
    const outcome = await result.current.mutateAsync({ action: 'add', idempotencyKey: 'key-12345678' });

    expect(outcome).toEqual({ kind: 'processed', result: confirmed });
    await waitFor(() =>
      expect(queryClient.getQueryData(allowlistKeys.status(WALLET))).toEqual({
        status: 'whitelisted',
        wallet: WALLET,
      }),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('failed result → processed with no cache write (edge)', async () => {
    submitAllowlistAction.mockResolvedValueOnce({
      ...confirmed,
      status: 'failed',
      isAllowed: null,
      txHash: null,
      errorReason: 'x',
    });
    const { queryClient, Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAllowlistAction(WALLET), { wrapper: Wrapper });
    const outcome = await result.current.mutateAsync({ action: 'add', idempotencyKey: 'key-12345678' });
    expect(outcome.kind).toBe('processed');
    expect(queryClient.getQueryData(allowlistKeys.status(WALLET))).toBeUndefined();
  });

  it('409 → conflict with mapped reason (edge)', async () => {
    submitAllowlistAction.mockRejectedValueOnce(
      new ApiError('noop', 409, 'KYC_ALLOWLIST_ALL_NOOP'),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAllowlistAction(WALLET), { wrapper: Wrapper });
    await expect(
      result.current.mutateAsync({ action: 'add', idempotencyKey: 'key-12345678' }),
    ).resolves.toEqual({ kind: 'conflict', reason: 'all_noop' });

    submitAllowlistAction.mockRejectedValueOnce(
      new ApiError('inflight', 409, 'IDEMPOTENCY_KEY_IN_FLIGHT'),
    );
    const { Wrapper: Wrapper2 } = makeWrapper(); // fresh cache per case (isolation)
    const { result: r2 } = renderHook(() => useAllowlistAction(WALLET), { wrapper: Wrapper2 });
    await expect(
      r2.current.mutateAsync({ action: 'add', idempotencyKey: 'key-abcdefgh' }),
    ).resolves.toEqual({ kind: 'conflict', reason: 'in_flight' });
  });

  it('rethrows a non-409 error (negative)', async () => {
    submitAllowlistAction.mockRejectedValueOnce(new ApiError('forbidden', 403, 'FORBIDDEN'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAllowlistAction(WALLET), { wrapper: Wrapper });
    await expect(
      result.current.mutateAsync({ action: 'remove', idempotencyKey: 'key-12345678' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('passes the caller-supplied idempotency key through as a variable', async () => {
    submitAllowlistAction.mockResolvedValueOnce(confirmed);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAllowlistAction(WALLET), { wrapper: Wrapper });
    await result.current.mutateAsync({ action: 'add', idempotencyKey: 'unique-key-1' });
    expect(submitAllowlistAction).toHaveBeenCalledWith(
      { wallet: WALLET, action: 'add', reason: undefined },
      'unique-key-1',
    );
  });
});
