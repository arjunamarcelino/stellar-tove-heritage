import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fakeExportBegin200,
  fakeSubmit200,
  fakeStatusConfirmed,
} from '@/test/fixtures/walletExport';

const h = vi.hoisted(() => ({
  exportBegin: vi.fn(),
  exportSubmit: vi.fn(),
  exportStatus: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/walletExport', () => ({
  exportBegin: h.exportBegin,
  exportSubmit: h.exportSubmit,
  exportStatus: h.exportStatus,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import {
  exportBeginAction,
  exportSubmitAction,
  exportStatusAction,
} from '@/app/actions/walletExport';

const WALLET_ID = '11111111-1111-1111-1111-111111111111';
const TARGET = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const SIGNED = [{ itemId: 'i1', authenticatorData: 'a', clientDataJSON: 'c', signature: 's' }];

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' }); // authenticated by default
});

describe('exportBeginAction', () => {
  it('returns SESSION_EXPIRED and does not call the service when no token cookie', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await exportBeginAction(WALLET_ID, TARGET)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.exportBegin).not.toHaveBeenCalled();
  });

  it('rejects a malformed address before calling the service', async () => {
    expect(await exportBeginAction(WALLET_ID, 'not-an-address')).toMatchObject({
      status: 'error',
      code: 'VALIDATION_FAILED',
    });
    expect(h.exportBegin).not.toHaveBeenCalled();
  });

  it('delegates to the service with the cookie token on a valid address', async () => {
    h.exportBegin.mockResolvedValue({ status: 'success', data: fakeExportBegin200 });
    const result = await exportBeginAction(WALLET_ID, TARGET);
    expect(result).toEqual({ status: 'success', data: fakeExportBegin200 });
    expect(h.exportBegin).toHaveBeenCalledWith('tok', WALLET_ID, TARGET);
  });
});

describe('exportSubmitAction', () => {
  it('returns SESSION_EXPIRED when unauthenticated', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await exportSubmitAction(WALLET_ID, 'exp-1', SIGNED)).toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(h.exportSubmit).not.toHaveBeenCalled();
  });

  it('rejects an empty items array before delegating', async () => {
    expect(await exportSubmitAction(WALLET_ID, 'exp-1', [])).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(h.exportSubmit).not.toHaveBeenCalled();
  });

  it('delegates valid signed items to the service', async () => {
    h.exportSubmit.mockResolvedValue({ status: 'success', data: fakeSubmit200 });
    const result = await exportSubmitAction(WALLET_ID, 'exp-1', SIGNED);
    expect(result).toEqual({ status: 'success', data: fakeSubmit200 });
    expect(h.exportSubmit).toHaveBeenCalledWith('tok', WALLET_ID, 'exp-1', SIGNED);
  });
});

describe('exportStatusAction', () => {
  it('delegates to the service with the cookie token', async () => {
    h.exportStatus.mockResolvedValue({ status: 'success', data: fakeStatusConfirmed });
    const result = await exportStatusAction(WALLET_ID);
    expect(result).toEqual({ status: 'success', data: fakeStatusConfirmed });
    expect(h.exportStatus).toHaveBeenCalledWith('tok', WALLET_ID);
  });

  it('returns SESSION_EXPIRED when unauthenticated', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await exportStatusAction(WALLET_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.exportStatus).not.toHaveBeenCalled();
  });
});
