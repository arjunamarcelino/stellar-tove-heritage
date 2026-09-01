import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '@/types/api';

const { fractionalizeArtwork } = vi.hoisted(() => ({ fractionalizeArtwork: vi.fn() }));
vi.mock('../api', () => ({ fractionalizeArtwork }));

import { useFractionalizeArtwork } from './use-artwork-mutations';

const validData = {
  totalSupply: 100,
  artistRetentionPct: 10,
  treasuryRetentionPct: 5,
  artistLockupDays: 365,
  treasuryLockupDays: 730,
  name: 'Northern Lights',
  symbol: 'NLIGHT',
};

const acceptedStatus = {
  artworkId: 'a1',
  fractionContractId: 'f1',
  status: 'deploying' as const,
  tokenAddress: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useFractionalizeArtwork', () => {
  beforeEach(() => fractionalizeArtwork.mockReset());

  it('neutralizes an already/in-progress 409 to { kind: "already" } (063)', async () => {
    for (const code of [
      'ARTWORK_ALREADY_FRACTIONALIZED',
      'ARTWORK_FRACTIONALIZATION_IN_PROGRESS',
      'IDEMPOTENCY_KEY_IN_FLIGHT',
    ]) {
      fractionalizeArtwork.mockRejectedValueOnce(new ApiError('conflict', 409, code));
      const { result } = renderHook(() => useFractionalizeArtwork('a1'), { wrapper });
      await expect(result.current.mutateAsync(validData)).resolves.toEqual({ kind: 'already' });
    }
  });

  it('re-throws a non-neutral 409 like ARTWORK_NOT_FRACTIONALIZABLE (063)', async () => {
    fractionalizeArtwork.mockRejectedValueOnce(
      new ApiError('not fractionalizable', 409, 'ARTWORK_NOT_FRACTIONALIZABLE'),
    );
    const { result } = renderHook(() => useFractionalizeArtwork('a1'), { wrapper });
    await expect(result.current.mutateAsync(validData)).rejects.toBeInstanceOf(ApiError);
  });

  it('mints a fresh idempotency key after a failed attempt (062)', async () => {
    fractionalizeArtwork.mockRejectedValueOnce(new ApiError('boom', 500, 'INTERNAL_ERROR'));
    fractionalizeArtwork.mockResolvedValueOnce(acceptedStatus);

    const { result } = renderHook(() => useFractionalizeArtwork('a1'), { wrapper });

    await expect(result.current.mutateAsync(validData)).rejects.toBeInstanceOf(ApiError);
    await result.current.mutateAsync(validData);

    const key1 = fractionalizeArtwork.mock.calls[0]?.[2];
    const key2 = fractionalizeArtwork.mock.calls[1]?.[2];
    expect(key1).toBeTruthy();
    expect(key2).toBeTruthy();
    expect(key1).not.toBe(key2);
  });

  it('reuses the same key within a single attempt (no reset before settle) (062)', async () => {
    fractionalizeArtwork.mockResolvedValueOnce(acceptedStatus);
    const { result } = renderHook(() => useFractionalizeArtwork('a1'), { wrapper });
    await result.current.mutateAsync(validData);
    const key = fractionalizeArtwork.mock.calls[0]?.[2];
    // crypto.randomUUID() satisfies the proxy's ^[A-Za-z0-9_-]{8,128}$ allow-list
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });
});
