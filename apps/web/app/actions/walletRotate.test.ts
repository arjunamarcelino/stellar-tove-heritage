import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SOURCE_WALLET_ID,
  DEST_WALLET_ID,
  fakeRotateInitiate200,
  fakeRotateStatusConfirmed,
  fakeSignedItems,
} from '@/test/fixtures/walletRotate';

const h = vi.hoisted(() => ({
  rotateInitiate: vi.fn(),
  rotateSubmit: vi.fn(),
  rotateStatus: vi.fn(),
  rotateCancel: vi.fn(),
  getCurrentLedger: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/walletRotate', () => ({
  rotateInitiate: h.rotateInitiate,
  rotateSubmit: h.rotateSubmit,
  rotateStatus: h.rotateStatus,
  rotateCancel: h.rotateCancel,
}));
// Mock the server-only ledger module so importing the action doesn't pull `server-only` into the test.
vi.mock('@/lib/stellar/ledger', () => ({ getCurrentLedger: h.getCurrentLedger }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import {
  rotateInitiateAction,
  rotateSubmitAction,
  rotateStatusAction,
  rotateCancelAction,
  getCurrentLedgerAction,
} from '@/app/actions/walletRotate';

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' }); // authenticated by default
});

describe('rotateInitiateAction', () => {
  it('returns SESSION_EXPIRED and does not call the service when no token cookie', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await rotateInitiateAction(SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(h.rotateInitiate).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid destination before delegating', async () => {
    expect(await rotateInitiateAction(SOURCE_WALLET_ID, 'not-a-uuid')).toMatchObject({
      status: 'error',
      code: 'ROTATION_DESTINATION_INVALID',
    });
    expect(h.rotateInitiate).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid source as WALLET_NOT_FOUND before delegating', async () => {
    expect(await rotateInitiateAction('bad', DEST_WALLET_ID)).toMatchObject({
      code: 'WALLET_NOT_FOUND',
    });
    expect(h.rotateInitiate).not.toHaveBeenCalled();
  });

  it('delegates to the service with the cookie token on valid ids', async () => {
    h.rotateInitiate.mockResolvedValue({ status: 'success', data: fakeRotateInitiate200 });
    const result = await rotateInitiateAction(SOURCE_WALLET_ID, DEST_WALLET_ID);
    expect(result).toEqual({ status: 'success', data: fakeRotateInitiate200 });
    expect(h.rotateInitiate).toHaveBeenCalledWith('tok', SOURCE_WALLET_ID, DEST_WALLET_ID);
  });
});

describe('rotateSubmitAction', () => {
  it('rejects an empty items array before delegating', async () => {
    expect(await rotateSubmitAction(SOURCE_WALLET_ID, [])).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(h.rotateSubmit).not.toHaveBeenCalled();
  });

  it('forwards the ORIGINAL signed items unmodified', async () => {
    h.rotateSubmit.mockResolvedValue({
      status: 'success',
      data: { rotationId: 'r', status: 'submitting', items: [] },
    });
    await rotateSubmitAction(SOURCE_WALLET_ID, fakeSignedItems);
    expect(h.rotateSubmit).toHaveBeenCalledWith('tok', SOURCE_WALLET_ID, fakeSignedItems);
    // Same reference — the action must not strip/re-map fields before backend crypto verification.
    expect(h.rotateSubmit.mock.calls[0][2]).toBe(fakeSignedItems);
  });
});

describe('rotateStatusAction', () => {
  it('delegates to the service with the cookie token', async () => {
    h.rotateStatus.mockResolvedValue({ status: 'success', data: fakeRotateStatusConfirmed });
    const result = await rotateStatusAction(SOURCE_WALLET_ID);
    expect(result).toEqual({ status: 'success', data: fakeRotateStatusConfirmed });
    expect(h.rotateStatus).toHaveBeenCalledWith('tok', SOURCE_WALLET_ID);
  });

  it('returns SESSION_EXPIRED when unauthenticated', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await rotateStatusAction(SOURCE_WALLET_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.rotateStatus).not.toHaveBeenCalled();
  });
});

describe('rotateCancelAction', () => {
  it('delegates to the service and maps a non-uuid source to ROTATION_NOT_FOUND', async () => {
    expect(await rotateCancelAction('bad')).toMatchObject({ code: 'ROTATION_NOT_FOUND' });
    expect(h.rotateCancel).not.toHaveBeenCalled();

    h.rotateCancel.mockResolvedValue({ status: 'success', canceledId: 'r1' });
    expect(await rotateCancelAction(SOURCE_WALLET_ID)).toEqual({
      status: 'success',
      canceledId: 'r1',
    });
    expect(h.rotateCancel).toHaveBeenCalledWith('tok', SOURCE_WALLET_ID);
  });
});

describe('getCurrentLedgerAction', () => {
  it('returns the current ledger height from the reader (no auth required)', async () => {
    h.getCurrentLedger.mockResolvedValue(1234570);
    expect(await getCurrentLedgerAction()).toBe(1234570);
  });

  it('passes through a null (fail-soft) read', async () => {
    h.getCurrentLedger.mockResolvedValue(null);
    expect(await getCurrentLedgerAction()).toBeNull();
  });
});
