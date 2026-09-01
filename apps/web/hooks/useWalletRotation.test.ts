import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { fakeAssertionResponse } from '@/test/fixtures/passkey';
import {
  SOURCE_WALLET_ID,
  DEST_WALLET_ID,
  DEST_ADDRESS,
  fakeRotateInitiate200,
  fakeRotateSubmit200,
  fakeRotateStatusConfirmed,
  fakeFractionItemA,
  fakeFractionItemB,
} from '@/test/fixtures/walletRotate';
import type { RotationBeginData, RotationStatusData, WalletSummary } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  rotateInitiate: vi.fn(),
  rotateSubmit: vi.fn(),
  rotateStatus: vi.fn(),
  rotateCancel: vi.fn(),
  getCurrentLedger: vi.fn(),
  setPrimary: vi.fn(),
  startPasskeyAssertion: vi.fn(),
}));

vi.mock('@/app/actions/walletRotate', () => ({
  rotateInitiateAction: h.rotateInitiate,
  rotateSubmitAction: h.rotateSubmit,
  rotateStatusAction: h.rotateStatus,
  rotateCancelAction: h.rotateCancel,
  getCurrentLedgerAction: h.getCurrentLedger,
}));
vi.mock('@/app/actions/walletManage', () => ({ setPrimaryWalletAction: h.setPrimary }));
vi.mock('@/lib/webauthn/passkey', () => ({
  startPasskeyAssertion: h.startPasskeyAssertion,
  buildAssertionOptions: vi.fn((p) => p),
}));

import { useWalletRotation } from '@/hooks/useWalletRotation';

const DEST = { id: DEST_WALLET_ID, address: DEST_ADDRESS };
const WALLETS: WalletSummary[] = [
  {
    id: SOURCE_WALLET_ID,
    kind: 'embedded_passkey',
    address: 'CSRC',
    exported: false,
    isPrimary: true,
  },
  { id: DEST_WALLET_ID, kind: 'byow', address: DEST_ADDRESS, exported: false, isPrimary: false },
];

function mount(initialStatus: RotationStatusData | null = null) {
  return renderHook(() => useWalletRotation(SOURCE_WALLET_ID, WALLETS, initialStatus));
}

async function getToReviewing(result: { current: ReturnType<typeof useWalletRotation> }) {
  await act(async () => {
    await result.current.chooseDestination(DEST);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.setPrimary.mockResolvedValue({ status: 'success' });
  h.rotateInitiate.mockResolvedValue({ status: 'success', data: fakeRotateInitiate200 });
  h.rotateSubmit.mockResolvedValue({ status: 'success', data: fakeRotateSubmit200 });
  h.rotateStatus.mockResolvedValue({ status: 'success', data: fakeRotateStatusConfirmed });
  // Default: ledger read unavailable → the proactive freshness check is skipped (fail-soft).
  h.getCurrentLedger.mockResolvedValue(null);
  h.startPasskeyAssertion.mockResolvedValue({ status: 'success', response: fakeAssertionResponse });
});

describe('useWalletRotation', () => {
  it('starts by selecting a destination when no rotation is active', () => {
    const { result } = mount();
    expect(result.current.state).toMatchObject({ status: 'selectingDestination' });
  });

  it('sets W2 primary then initiates and lands on review with the fraction items', async () => {
    const { result } = mount();
    await getToReviewing(result);
    expect(h.setPrimary).toHaveBeenCalledWith(DEST_WALLET_ID);
    expect(h.rotateInitiate).toHaveBeenCalledWith(SOURCE_WALLET_ID, DEST_WALLET_ID);
    expect(result.current.state).toMatchObject({
      status: 'reviewing',
      items: fakeRotateInitiate200.items,
    });
  });

  it('surfaces a lockup block with the ISO expiry and no items (Confirm gate)', async () => {
    h.rotateInitiate.mockResolvedValue({
      status: 'error',
      code: 'ROTATION_BLOCKED_BY_LOCKUP',
      message: 'blocked',
      lockupExpiresAt: '2026-11-04T00:00:00.000Z',
    });
    const { result } = mount();
    await getToReviewing(result);
    expect(result.current.state).toMatchObject({
      status: 'reviewing',
      blocked: { code: 'ROTATION_BLOCKED_BY_LOCKUP', lockupExpiresAt: '2026-11-04T00:00:00.000Z' },
    });
  });

  it('signs every item, submits, polls, and completes (movedCount = N)', async () => {
    const { result } = mount();
    await getToReviewing(result);
    await act(async () => {
      await result.current.confirmAndTransfer();
    });
    expect(h.startPasskeyAssertion).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ status: 'complete', destination: DEST, movedCount: 2 });
    // Happy path never re-initiates (no rebuild) — confirmed items are never re-signed.
    expect(h.rotateInitiate).toHaveBeenCalledTimes(1);
  });

  it('batches submit into chunks of ≤4 for a 5-item rotation', async () => {
    const fiveItems: RotationBeginData = {
      ...fakeRotateInitiate200,
      items: Array.from({ length: 5 }, (_, i) => ({
        ...fakeFractionItemA,
        itemId: `item-${i}`,
        challenge: `chal-${i}`,
      })),
    };
    h.rotateInitiate.mockResolvedValue({ status: 'success', data: fiveItems });
    h.rotateStatus.mockResolvedValue({
      status: 'success',
      data: {
        ...fakeRotateStatusConfirmed,
        items: fiveItems.items.map((it) => ({
          itemId: it.itemId,
          tokenContract: it.tokenContract,
          amountScaled: it.amountScaled,
          status: 'confirmed' as const,
          txHash: 'h',
          ledger: 1,
        })),
      },
    });
    const { result } = mount();
    await getToReviewing(result);
    await act(async () => {
      await result.current.confirmAndTransfer();
    });
    expect(h.startPasskeyAssertion).toHaveBeenCalledTimes(5);
    expect(h.rotateSubmit).toHaveBeenCalledTimes(2); // 4 + 1
    expect(result.current.state).toMatchObject({ status: 'complete', movedCount: 5 });
  });

  it('pauses (not error) when the passkey is cancelled after ≥1 item confirmed', async () => {
    h.startPasskeyAssertion
      .mockResolvedValueOnce({ status: 'success', response: fakeAssertionResponse })
      .mockResolvedValueOnce({ status: 'cancelled' });
    // Post-cancel reconcile: item A confirmed, item B still pending.
    h.rotateStatus.mockResolvedValue({
      status: 'success',
      data: {
        ...fakeRotateStatusConfirmed,
        items: [
          {
            itemId: fakeFractionItemA.itemId,
            tokenContract: 'CA',
            amountScaled: '500',
            status: 'confirmed',
            txHash: 'h',
            ledger: 1,
          },
          {
            itemId: fakeFractionItemB.itemId,
            tokenContract: 'CB',
            amountScaled: '120',
            status: 'pending',
          },
        ],
      },
    });
    const { result } = mount();
    await getToReviewing(result);
    await act(async () => {
      await result.current.confirmAndTransfer();
    });
    expect(result.current.state).toMatchObject({ status: 'paused', confirmedCount: 1, total: 2 });
  });

  it('returns to review when the passkey is cancelled before anything confirmed', async () => {
    h.startPasskeyAssertion.mockResolvedValue({ status: 'cancelled' });
    h.rotateStatus.mockResolvedValue({
      status: 'success',
      data: {
        ...fakeRotateStatusConfirmed,
        items: [
          {
            itemId: fakeFractionItemA.itemId,
            tokenContract: 'CA',
            amountScaled: '500',
            status: 'pending',
          },
          {
            itemId: fakeFractionItemB.itemId,
            tokenContract: 'CB',
            amountScaled: '120',
            status: 'pending',
          },
        ],
      },
    });
    const { result } = mount();
    await getToReviewing(result);
    await act(async () => {
      await result.current.confirmAndTransfer();
    });
    expect(result.current.state).toMatchObject({ status: 'reviewing' });
  });

  it('rebuilds fresh challenges before signing when the current ledger shows them expired', async () => {
    const stale: RotationBeginData = {
      ...fakeRotateInitiate200,
      items: fakeRotateInitiate200.items.map((i) => ({ ...i, expiresAtLedger: 1000 })),
    };
    const fresh: RotationBeginData = {
      ...fakeRotateInitiate200,
      items: fakeRotateInitiate200.items.map((i) => ({ ...i, expiresAtLedger: 9999 })),
    };
    h.rotateInitiate
      .mockResolvedValueOnce({ status: 'success', data: stale }) // chooseDestination
      .mockResolvedValueOnce({ status: 'success', data: fresh }); // proactive refresh before signing
    h.getCurrentLedger.mockResolvedValue(5000); // 1000 <= 5000 → stale challenges

    const { result } = mount();
    await getToReviewing(result);
    await act(async () => {
      await result.current.confirmAndTransfer();
    });
    // A refresh initiate happened before signing (2 total), and the flow still completes.
    expect(h.rotateInitiate).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({ status: 'complete', movedCount: 2 });
  });

  it('routes a submit error to settlementUnknown (never blind-resubmit)', async () => {
    h.rotateSubmit.mockResolvedValue({ status: 'error', code: 'NETWORK_ERROR', message: 'down' });
    const { result } = mount();
    await getToReviewing(result);
    await act(async () => {
      await result.current.confirmAndTransfer();
    });
    expect(result.current.state).toMatchObject({ status: 'settlementUnknown' });
  });

  it('resume rehydrates a confirmed rotation directly to complete', async () => {
    const active: RotationStatusData = fakeRotateStatusConfirmed;
    const { result } = mount(active);
    expect(result.current.state).toEqual({ status: 'loading' });
    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.state).toMatchObject({ status: 'complete', movedCount: 2 });
    // A fully-confirmed rotation is never re-initiated / re-signed on resume.
    expect(h.rotateInitiate).not.toHaveBeenCalled();
    expect(h.startPasskeyAssertion).not.toHaveBeenCalled();
  });

  it('resume: a partial rotation whose re-initiate fails → settlementUnknown, NOT a countless error', async () => {
    const partial: RotationStatusData = {
      rotationId: 'r1',
      state: 'submitting',
      destinationWalletId: DEST_WALLET_ID,
      destinationAddress: DEST_ADDRESS,
      items: [
        {
          itemId: 'i1',
          tokenContract: 'CA',
          amountScaled: '500',
          status: 'confirmed',
          txHash: 'h',
          ledger: 1,
        },
        { itemId: 'i2', tokenContract: 'CB', amountScaled: '120', status: 'pending' },
      ],
    };
    h.rotateStatus.mockResolvedValue({ status: 'success', data: partial });
    // The follow-up re-initiate fails (e.g. SESSION_EXPIRED after a tab-reopen).
    h.rotateInitiate.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'expired',
    });
    const { result } = mount(partial);
    await act(async () => {
      await result.current.resume();
    });
    // Must preserve the moved count + denominator, never claim "nothing moved".
    expect(result.current.state).toMatchObject({
      status: 'settlementUnknown',
      confirmedCount: 1,
      total: 2,
    });
  });
});
