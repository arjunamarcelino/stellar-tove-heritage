import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { EscrowDeployStatus, OfferingDetail, OfferingStatus } from '../schemas';

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { derivePanelState, useOfferingApprovalLifecycle } from './use-offering-approval-lifecycle';

const C_ADDR = 'C' + 'A'.repeat(55);

function mkDetail(over: {
  status?: OfferingStatus;
  deployStatus?: EscrowDeployStatus;
  contractAddress?: string | null;
  count?: number;
  youApproved?: boolean;
}): OfferingDetail {
  return {
    id: 'o1',
    artworkId: 'a1',
    status: over.status ?? 'planned',
    lowPriceStroops: '1000000',
    highPriceStroops: '5000000',
    publicFloat: '800000',
    windowOpenAt: '2026-09-01T00:00:00.000Z',
    windowCloseAt: '2026-09-08T00:00:00.000Z',
    attestedArtistAddress: null,
    escrow: {
      deployStatus: over.deployStatus ?? null,
      contractAddress: over.contractAddress ?? null,
      deployLedger: null,
      approvedAt: null,
    },
    approvals: { count: over.count ?? 0, threshold: 2, youApproved: over.youApproved ?? false },
  } as unknown as OfferingDetail;
}

describe('derivePanelState', () => {
  it('can-approve when planned + below quorum and not yet signed', () => {
    expect(derivePanelState(mkDetail({}))).toEqual({ kind: 'can-approve' });
  });

  it('already-approved when the detail youApproved is true', () => {
    expect(derivePanelState(mkDetail({ youApproved: true }))).toEqual({ kind: 'already-approved' });
  });

  it('not-a-signer shows for a planned offering the admin cannot sign', () => {
    expect(derivePanelState(mkDetail({}), { notASigner: true })).toEqual({ kind: 'not-a-signer' });
  });

  it('a later latch/deploy overrides the sticky not-a-signer flag', () => {
    expect(
      derivePanelState(mkDetail({ status: 'approved', deployStatus: 'deployed', contractAddress: C_ADDR }), {
        notASigner: true,
      }),
    ).toEqual({ kind: 'deployed', contractAddress: C_ADDR });
    expect(derivePanelState(mkDetail({ count: 2, deployStatus: 'deploying' }), { notASigner: true }).kind).toBe(
      'deploying',
    );
  });

  it('deploying for the quorum transient and the deploying flag', () => {
    expect(derivePanelState(mkDetail({ count: 2 })).kind).toBe('deploying');
    expect(derivePanelState(mkDetail({ deployStatus: 'deploying' })).kind).toBe('deploying');
  });

  it('deploy-failed and deployed(latched)', () => {
    expect(derivePanelState(mkDetail({ count: 2, deployStatus: 'failed' })).kind).toBe('deploy-failed');
    expect(
      derivePanelState(mkDetail({ status: 'approved', deployStatus: 'deployed', contractAddress: C_ADDR })),
    ).toEqual({ kind: 'deployed', contractAddress: C_ADDR });
  });

  it('deployed-without-valid-address stays deploying (not a false success)', () => {
    expect(
      derivePanelState(mkDetail({ status: 'planned', count: 2, deployStatus: 'deployed', contractAddress: null }))
        .kind,
    ).toBe('deploying');
  });

  it('read-only for non-planned terminal statuses', () => {
    expect(derivePanelState(mkDetail({ status: 'opened' }))).toEqual({ kind: 'read-only', status: 'opened' });
    expect(derivePanelState(mkDetail({ status: 'canceled' }))).toEqual({ kind: 'read-only', status: 'canceled' });
  });
});

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper };
}

describe('useOfferingApprovalLifecycle terminal toast', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('fires success once when a deploying offering latches to approved', () => {
    const { Wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ d }: { d: OfferingDetail }) => useOfferingApprovalLifecycle(d),
      { wrapper: Wrapper, initialProps: { d: mkDetail({ count: 2, deployStatus: 'deploying' }) } },
    );
    expect(toastSuccess).not.toHaveBeenCalled(); // silent baseline
    rerender({ d: mkDetail({ status: 'approved', deployStatus: 'deployed', contractAddress: C_ADDR }) });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    // re-render with the same latched state → no duplicate toast
    rerender({ d: mkDetail({ status: 'approved', deployStatus: 'deployed', contractAddress: C_ADDR }) });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not fire when opening an already-approved offering (baseline)', () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useOfferingApprovalLifecycle(mkDetail({ status: 'approved', deployStatus: 'deployed', contractAddress: C_ADDR })), {
      wrapper: Wrapper,
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('does not fire when detail loads undefined-first then arrives already-latched (real app path)', () => {
    const { Wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ d }: { d: OfferingDetail | undefined }) => useOfferingApprovalLifecycle(d),
      { wrapper: Wrapper, initialProps: { d: undefined as OfferingDetail | undefined } },
    );
    rerender({ d: mkDetail({ status: 'approved', deployStatus: 'deployed', contractAddress: C_ADDR }) });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('does not double-fire when the poll flaps latched → regress → latched', () => {
    const { Wrapper } = makeWrapper();
    const latchedDetail = mkDetail({ status: 'approved', deployStatus: 'deployed', contractAddress: C_ADDR });
    const { rerender } = renderHook(
      ({ d }: { d: OfferingDetail }) => useOfferingApprovalLifecycle(d),
      { wrapper: Wrapper, initialProps: { d: mkDetail({ count: 2, deployStatus: 'deploying' }) } },
    );
    rerender({ d: latchedDetail });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    rerender({ d: mkDetail({ status: 'planned', count: 2, deployStatus: null }) }); // lagging regression
    rerender({ d: latchedDetail }); // re-latch
    expect(toastSuccess).toHaveBeenCalledTimes(1); // still once
  });

  it('fires error when a deploy fails', () => {
    const { Wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ d }: { d: OfferingDetail }) => useOfferingApprovalLifecycle(d),
      { wrapper: Wrapper, initialProps: { d: mkDetail({ count: 2, deployStatus: 'deploying' }) } },
    );
    rerender({ d: mkDetail({ count: 2, deployStatus: 'failed' }) });
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
