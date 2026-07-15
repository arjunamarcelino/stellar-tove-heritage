import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  addWalletChallenge: vi.fn(),
  addWallet: vi.fn(),
  removeWallet: vi.fn(),
  setPrimaryWallet: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/walletManage', () => ({
  addWalletChallenge: h.addWalletChallenge,
  addWallet: h.addWallet,
  removeWallet: h.removeWallet,
  setPrimaryWallet: h.setPrimaryWallet,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import {
  addWalletChallengeAction,
  addWalletAction,
  removeWalletAction,
  setPrimaryWalletAction,
} from '@/app/actions/walletManage';

const VALID_PK = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const VALID_SIGNED = 'AAAAABBBBCCCC==';
const VALID_KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

// A valid RFC-4122 v4 UUID (variant nibble 8-b) — the all-4s fixture ids are not (variant 4).
const WALLET_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' }); // authenticated by default
});

describe('addWalletChallengeAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await addWalletChallengeAction(VALID_PK)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.addWalletChallenge).not.toHaveBeenCalled();
  });

  it('rejects a non-G/muxed address before delegating', async () => {
    expect(await addWalletChallengeAction('MABC-muxed')).toMatchObject({
      status: 'error',
      code: 'VALIDATION_FAILED',
    });
    expect(h.addWalletChallenge).not.toHaveBeenCalled();
  });

  it('delegates with the cookie token on a valid public key', async () => {
    h.addWalletChallenge.mockResolvedValue({
      status: 'success',
      challengeTxXdr: 'x',
      networkPassphrase: 'p',
    });
    await addWalletChallengeAction(VALID_PK);
    expect(h.addWalletChallenge).toHaveBeenCalledWith('tok', VALID_PK);
  });
});

describe('addWalletAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await addWalletAction(VALID_SIGNED, VALID_KEY)).toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(h.addWallet).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid idempotency key before delegating', async () => {
    expect(await addWalletAction(VALID_SIGNED, 'not-a-uuid')).toMatchObject({
      status: 'error',
      code: 'VALIDATION_FAILED',
    });
    expect(h.addWallet).not.toHaveBeenCalled();
  });

  it('rejects a malformed signed XDR before delegating', async () => {
    expect(await addWalletAction('has spaces!', VALID_KEY)).toMatchObject({
      status: 'error',
      code: 'VALIDATION_FAILED',
    });
    expect(h.addWallet).not.toHaveBeenCalled();
  });

  it('delegates with the cookie token, signed XDR, and key on valid input', async () => {
    h.addWallet.mockResolvedValue({ status: 'success', wallet: {} });
    await addWalletAction(VALID_SIGNED, VALID_KEY);
    expect(h.addWallet).toHaveBeenCalledWith('tok', VALID_SIGNED, VALID_KEY);
  });
});

describe('removeWalletAction', () => {
  it('returns SESSION_EXPIRED and does not call the service when no token cookie', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await removeWalletAction(WALLET_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.removeWallet).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id before calling the service', async () => {
    expect(await removeWalletAction('not-a-uuid')).toMatchObject({
      status: 'error',
      code: 'WALLET_NOT_FOUND',
    });
    expect(h.removeWallet).not.toHaveBeenCalled();
  });

  it('delegates to the service with the cookie token on a valid id', async () => {
    h.removeWallet.mockResolvedValue({ status: 'success', newPrimaryWalletId: null });
    expect(await removeWalletAction(WALLET_ID)).toEqual({
      status: 'success',
      newPrimaryWalletId: null,
    });
    expect(h.removeWallet).toHaveBeenCalledWith('tok', WALLET_ID);
  });
});

describe('setPrimaryWalletAction', () => {
  it('returns SESSION_EXPIRED and does not call the service when no token cookie', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await setPrimaryWalletAction(WALLET_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.setPrimaryWallet).not.toHaveBeenCalled();
  });

  it('maps a non-uuid id to WALLET_NOT_FOUND without calling the service', async () => {
    expect(await setPrimaryWalletAction('not-a-uuid')).toMatchObject({
      status: 'error',
      code: 'WALLET_NOT_FOUND',
    });
    expect(h.setPrimaryWallet).not.toHaveBeenCalled();
  });

  it('delegates to the service with the cookie token on a valid id', async () => {
    h.setPrimaryWallet.mockResolvedValue({ status: 'success' });
    expect(await setPrimaryWalletAction(WALLET_ID)).toEqual({ status: 'success' });
    expect(h.setPrimaryWallet).toHaveBeenCalledWith('tok', WALLET_ID);
  });
});
