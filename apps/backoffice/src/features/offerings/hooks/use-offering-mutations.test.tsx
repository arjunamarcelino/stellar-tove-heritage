import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ZodError } from 'zod';

import { offeringKeys } from '@/lib/query-keys';
import { ApiError } from '@/types/api';
import type { OfferingDetail } from '../schemas';

const { approveOffering } = vi.hoisted(() => ({ approveOffering: vi.fn() }));
vi.mock('../api', () => ({ approveOffering }));

import { useApproveOffering } from './use-offering-mutations';

const BIG = '170141183460469231731687303715884105727';

function seedDetail(): OfferingDetail {
  return {
    id: 'o1',
    artworkId: 'a1',
    status: 'planned',
    lowPriceStroops: BIG,
    highPriceStroops: '5000000',
    publicFloat: '800000',
    windowOpenAt: '2026-09-01T00:00:00.000Z',
    windowCloseAt: '2026-09-08T00:00:00.000Z',
    attestedArtistAddress: null,
    escrow: { deployStatus: null, contractAddress: null, deployLedger: null, approvedAt: null },
    approvals: { count: 1, threshold: 2, signers: ['sub1'] },
  } as unknown as OfferingDetail;
}

function res(deployStatus: 'deploying' | null, count: number) {
  return {
    offeringId: 'o1',
    status: 'planned',
    approvals: { count, threshold: 2, youApproved: true, signers: ['sub1'] },
    escrow: { deployStatus, contractAddress: null },
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

describe('useApproveOffering', () => {
  beforeEach(() => approveOffering.mockReset());

  it('quorum 202: optimistic deploying flip preserves i128, invalidates lists NOT detail (positive)', async () => {
    approveOffering.mockResolvedValueOnce(res('deploying', 2));
    const { queryClient, Wrapper } = makeWrapper();
    queryClient.setQueryData(offeringKeys.detail('o1'), seedDetail());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useApproveOffering('o1'), { wrapper: Wrapper });
    const outcome = await result.current.mutateAsync('key-1234-5678');

    expect(outcome).toMatchObject({ kind: 'accepted', deploying: true });
    await waitFor(() => {
      const d = queryClient.getQueryData<OfferingDetail>(offeringKeys.detail('o1'));
      expect(d?.escrow.deployStatus).toBe('deploying');
      expect(d?.lowPriceStroops).toBe(BIG); // i128 untouched by the nested spread
    });
    // detail was NOT invalidated (would clobber the optimistic flag); lists WAS.
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(offeringKeys.lists()));
    expect(keys).not.toContain(JSON.stringify(offeringKeys.detail('o1')));
  });

  it('first-signer 202 (non-quorum): invalidates detail, no optimistic deploying (edge)', async () => {
    approveOffering.mockResolvedValueOnce(res(null, 1));
    const { queryClient, Wrapper } = makeWrapper();
    queryClient.setQueryData(offeringKeys.detail('o1'), seedDetail());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useApproveOffering('o1'), { wrapper: Wrapper });
    const outcome = await result.current.mutateAsync('key-1234-5678');

    expect(outcome).toMatchObject({ kind: 'accepted', deploying: false });
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(offeringKeys.detail('o1')));
  });

  it('neutral conflict codes → neutralized, not a thrown error (edge)', async () => {
    for (const code of [
      'OFFERING_APPROVAL_IN_PROGRESS',
      'IDEMPOTENCY_KEY_IN_FLIGHT',
      'OFFERING_NOT_PLANNED',
    ]) {
      approveOffering.mockRejectedValueOnce(new ApiError('x', 409, code));
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useApproveOffering('o1'), { wrapper: Wrapper });
      await expect(result.current.mutateAsync('key-1234-5678')).resolves.toEqual({ kind: 'neutralized' });
    }
  });

  it('403 NOT_A_SIGNER → not-a-signer outcome (edge)', async () => {
    approveOffering.mockRejectedValueOnce(new ApiError('x', 403, 'OFFERING_APPROVAL_NOT_A_SIGNER'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApproveOffering('o1'), { wrapper: Wrapper });
    await expect(result.current.mutateAsync('key-1234-5678')).resolves.toEqual({ kind: 'not-a-signer' });
  });

  it('genuine errors rethrow (mismatch / not-found) (negative)', async () => {
    approveOffering.mockRejectedValueOnce(new ApiError('x', 422, 'IDEMPOTENCY_KEY_MISMATCH'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApproveOffering('o1'), { wrapper: Wrapper });
    await expect(result.current.mutateAsync('key-1234-5678')).rejects.toBeInstanceOf(ApiError);
  });

  it('a 2xx body that fails schema parse → accepted-uncertain, NOT a thrown error (edge)', async () => {
    approveOffering.mockRejectedValueOnce(new ZodError([]));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApproveOffering('o1'), { wrapper: Wrapper });
    await expect(result.current.mutateAsync('key-1234-5678')).resolves.toEqual({
      kind: 'accepted',
      deploying: false,
    });
  });

  it('forwards the caller-supplied idempotency key to approveOffering (edge)', async () => {
    // The key lifecycle (fresh per approve-INTENT, reused across same-intent retries) is owned by the
    // container (offering-detail); the hook just forwards the key variable.
    approveOffering.mockResolvedValueOnce(res(null, 1));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApproveOffering('o1'), { wrapper: Wrapper });
    await result.current.mutateAsync('intent-key-abcd');
    expect(approveOffering).toHaveBeenCalledWith('o1', 'intent-key-abcd');
  });
});
