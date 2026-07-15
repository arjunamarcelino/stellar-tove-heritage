import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  fakeExportBegin200,
  fakeSubmit200,
  fakeStatusConfirmed,
} from '@/test/fixtures/walletExport';
import { fakeAssertionResponse } from '@/test/fixtures/passkey';

const h = vi.hoisted(() => ({
  exportBegin: vi.fn(),
  exportSubmit: vi.fn(),
  exportStatus: vi.fn(),
  startPasskeyAssertion: vi.fn(),
}));

vi.mock('@/app/actions/walletExport', () => ({
  exportBeginAction: h.exportBegin,
  exportSubmitAction: h.exportSubmit,
  exportStatusAction: h.exportStatus,
}));
vi.mock('@/lib/webauthn/passkey', () => ({
  startPasskeyAssertion: h.startPasskeyAssertion,
  // Pure options assembler — pass a stub through; the hook only forwards its output to the mock above.
  buildAssertionOptions: vi.fn((p) => p),
}));

import { useWalletExport } from '@/hooks/useWalletExport';

const WALLET_ID = '11111111-1111-1111-1111-111111111111';
const OWN = 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME';
const TARGET = fakeExportBegin200.targetAddress;

function mount() {
  return renderHook(() => useWalletExport(WALLET_ID, OWN));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.exportBegin.mockResolvedValue({ status: 'success', data: fakeExportBegin200 });
  h.startPasskeyAssertion.mockResolvedValue({ status: 'success', response: fakeAssertionResponse });
  h.exportSubmit.mockResolvedValue({ status: 'success', data: fakeSubmit200 });
  h.exportStatus.mockResolvedValue({ status: 'success', data: fakeStatusConfirmed });
});

describe('useWalletExport', () => {
  it('starts idle and walks educate → address entry', () => {
    const { result } = mount();
    expect(result.current.state).toEqual({ status: 'idle' });
    act(() => result.current.start());
    expect(result.current.state).toEqual({ status: 'educating' });
    act(() => result.current.acknowledgeEducation());
    expect(result.current.state).toEqual({ status: 'enteringAddress' });
  });

  it('rejects the wallet’s own address inline without calling the backend', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(OWN);
    });
    expect(result.current.state).toMatchObject({ status: 'enteringAddress' });
    expect(h.exportBegin).not.toHaveBeenCalled();
  });

  it('surfaces RECIPIENT_NOT_WHITELISTED as an inline error on the address step', async () => {
    h.exportBegin.mockResolvedValue({
      status: 'error',
      code: 'RECIPIENT_NOT_WHITELISTED',
      message: 'KYC required',
    });
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(TARGET);
    });
    expect(result.current.state).toMatchObject({
      status: 'enteringAddress',
      inlineError: 'KYC required',
    });
  });

  it('confirms then signs every item and reconciles to success', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(TARGET);
    });
    expect(result.current.state).toMatchObject({ status: 'confirming' });

    await act(async () => {
      await result.current.confirmAndSign();
    });

    // one assertion per item
    expect(h.startPasskeyAssertion).toHaveBeenCalledTimes(fakeExportBegin200.items.length);
    // submit forwarded the signed items under the exportId
    expect(h.exportSubmit).toHaveBeenCalledWith(
      WALLET_ID,
      fakeExportBegin200.exportId,
      expect.arrayContaining([expect.objectContaining({ itemId: expect.any(String) })]),
    );
    expect(result.current.state).toMatchObject({
      status: 'success',
      selfCustodyAddress: fakeStatusConfirmed.selfCustodyAddress,
    });
  });

  it('returns to confirming (nothing submitted) when the passkey is cancelled', async () => {
    h.startPasskeyAssertion.mockResolvedValue({ status: 'cancelled' });
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(TARGET);
    });
    await act(async () => {
      await result.current.confirmAndSign();
    });
    expect(result.current.state).toMatchObject({ status: 'confirming' });
    expect(h.exportSubmit).not.toHaveBeenCalled();
  });

  it('lands in settlementUnknown (not error) on a network drop after submit', async () => {
    h.exportSubmit.mockResolvedValue({
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'offline',
    });
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(TARGET);
    });
    await act(async () => {
      await result.current.confirmAndSign();
    });
    expect(result.current.state).toEqual({ status: 'settlementUnknown' });
    expect(h.exportStatus).not.toHaveBeenCalled();
  });

  it('reset() aborts an in-flight reconcile poll and returns to idle (todo 070)', async () => {
    vi.useFakeTimers();
    try {
      // status never settles → the loop parks on delay() until aborted.
      h.exportStatus.mockResolvedValue({
        status: 'success',
        data: { exportId: 'e', state: 'pending', items: [] },
      });
      const { result } = mount();
      await act(async () => {
        await result.current.submitAddress(TARGET);
      });
      // Kick off signing+submit+reconcile without awaiting (it would loop forever on 'pending').
      act(() => {
        void result.current.confirmAndSign();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0); // flush microtasks → reconcile parks on delay()
      });
      act(() => result.current.reset());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state).toEqual({ status: 'idle' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles a failed export with a moved item to partial, enriched with begin display fields', async () => {
    const usdc = fakeExportBegin200.items[0]; // usdc, displayName 'USDC', decimals 7
    h.exportStatus.mockResolvedValue({
      status: 'success',
      data: {
        exportId: 'e1',
        state: 'failed',
        items: [
          {
            tokenContract: usdc.tokenContract,
            tokenKind: 'usdc',
            status: 'confirmed',
            txHash: 'ab',
          },
          { tokenContract: 'C2', tokenKind: 'fraction', status: 'failed' },
        ],
      },
    });
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(TARGET);
    });
    await act(async () => {
      await result.current.confirmAndSign();
    });
    expect(result.current.state).toMatchObject({ status: 'partial' });
    // The matching item is enriched from the begin item (by tokenContract); the unmatched one isn't.
    if (result.current.state.status === 'partial') {
      expect(result.current.state.items[0]).toMatchObject({
        displayName: usdc.displayName,
        amountScaled: usdc.amountScaled,
        decimals: usdc.decimals,
      });
      expect(result.current.state.items[1].displayName).toBeUndefined();
    }
  });

  it('does not claim "nothing moved" when a failed aggregate still has an in-flight item (todo 068)', async () => {
    h.exportStatus.mockResolvedValue({
      status: 'success',
      data: {
        exportId: 'e1',
        state: 'failed',
        items: [
          { tokenContract: 'C1', tokenKind: 'usdc', status: 'submitted' }, // still in flight
          { tokenContract: 'C2', tokenKind: 'fraction', status: 'failed' },
        ],
      },
    });
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(TARGET);
    });
    await act(async () => {
      await result.current.confirmAndSign();
    });
    expect(result.current.state).toEqual({ status: 'settlementUnknown' });
  });

  it('reports all-terminally-failed as a "nothing moved" error', async () => {
    h.exportStatus.mockResolvedValue({
      status: 'success',
      data: {
        exportId: 'e1',
        state: 'failed',
        items: [{ tokenContract: 'C1', tokenKind: 'usdc', status: 'failed' }],
      },
    });
    const { result } = mount();
    await act(async () => {
      await result.current.submitAddress(TARGET);
    });
    await act(async () => {
      await result.current.confirmAndSign();
    });
    expect(result.current.state).toMatchObject({
      status: 'error',
      code: 'TRANSFER_FAILED',
    });
  });
});
