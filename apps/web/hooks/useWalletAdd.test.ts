import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  addWalletChallengeAction: vi.fn(),
  addWalletAction: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock('@/app/actions/walletManage', () => ({
  addWalletChallengeAction: h.addWalletChallengeAction,
  addWalletAction: h.addWalletAction,
}));
vi.mock('@/lib/wallet/freighter', () => ({
  freighterProvider: { getPublicKey: h.getPublicKey, signTransaction: h.signTransaction },
}));
vi.mock('@/lib/wallet/albedo', () => ({
  albedoProvider: { getPublicKey: h.getPublicKey, signTransaction: h.signTransaction },
}));

import { useWalletAdd } from '@/hooks/useWalletAdd';

// Wire the full happy path up to (but not including) the final submit.
function primeThroughSign() {
  h.getPublicKey.mockResolvedValue({ status: 'success', data: 'GPK' });
  h.addWalletChallengeAction.mockResolvedValue({
    status: 'success',
    challengeTxXdr: 'CX',
    networkPassphrase: 'NP',
  });
  h.signTransaction.mockResolvedValue({ status: 'success', data: 'SIGNED' });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.randomUUID.mockReturnValue('key-uuid-1');
  vi.stubGlobal('crypto', { randomUUID: h.randomUUID });
});

describe('useWalletAdd', () => {
  it('runs connect → challenge → sign → submit and reaches success', async () => {
    primeThroughSign();
    h.addWalletAction.mockResolvedValue({ status: 'success', wallet: { id: 'w' } });

    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    expect(result.current.state.status).toBe('readyToSign');

    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state.status).toBe('success');
    expect(h.addWalletAction).toHaveBeenCalledWith('SIGNED', 'key-uuid-1');
  });

  it('returns to idle on a provider cancel without fetching a challenge', async () => {
    h.getPublicKey.mockResolvedValue({ status: 'error', code: 'USER_CANCELLED', message: 'x' });
    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    expect(result.current.state.status).toBe('idle');
    expect(h.addWalletChallengeAction).not.toHaveBeenCalled();
  });

  it('retry-send resubmits the SAME signed body + key; the key is minted once', async () => {
    primeThroughSign();
    h.addWalletAction
      .mockResolvedValueOnce({ status: 'error', code: 'NETWORK_ERROR', message: 'net' })
      .mockResolvedValueOnce({ status: 'success', wallet: { id: 'w' } });

    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'retry-send' });

    await act(async () => {
      await result.current.retrySend();
    });
    expect(result.current.state.status).toBe('success');
    expect(h.addWalletAction).toHaveBeenNthCalledWith(1, 'SIGNED', 'key-uuid-1');
    expect(h.addWalletAction).toHaveBeenNthCalledWith(2, 'SIGNED', 'key-uuid-1');
    expect(h.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('classifies IDEMPOTENCY_KEY_MISMATCH (422) as restart, not retry-send (no 422 loop)', async () => {
    primeThroughSign();
    h.addWalletAction.mockResolvedValue({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_MISMATCH',
      message: 'Something changed mid-request. Please try again.',
    });
    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'restart' });
  });

  it('classifies IDEMPOTENCY_KEY_IN_FLIGHT (409) as retry-send', async () => {
    primeThroughSign();
    h.addWalletAction.mockResolvedValue({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      message: 'Still finishing your previous request — one moment…',
    });
    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'retry-send' });
  });

  it('surfaces an error (restart) when crypto.randomUUID throws (insecure context), without submitting', async () => {
    primeThroughSign();
    h.randomUUID.mockImplementation(() => {
      throw new Error('crypto.randomUUID is not available in an insecure context');
    });
    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'restart' });
    expect(h.addWalletAction).not.toHaveBeenCalled();
  });

  it('classifies WALLET_ALREADY_BOUND as terminal (no retry affordance)', async () => {
    primeThroughSign();
    h.addWalletAction.mockResolvedValue({
      status: 'error',
      code: 'WALLET_ALREADY_BOUND',
      message: 'This wallet is already linked to another Tove account.',
    });
    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'terminal' });
  });

  it('restart (reset) discards the key so a fresh challenge mints a new one', async () => {
    primeThroughSign();
    h.randomUUID.mockReturnValueOnce('key-1').mockReturnValueOnce('key-2');
    h.addWalletAction
      .mockResolvedValueOnce({ status: 'error', code: 'AUTH_CHALLENGE_EXPIRED', message: 'exp' })
      .mockResolvedValueOnce({ status: 'success', wallet: { id: 'w' } });

    const { result } = renderHook(() => useWalletAdd());
    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'restart' });

    act(() => result.current.reset());
    expect(result.current.state.status).toBe('idle');

    await act(async () => {
      await result.current.selectProvider('freighter');
    });
    await act(async () => {
      await result.current.sign();
    });
    expect(h.addWalletAction).toHaveBeenNthCalledWith(2, 'SIGNED', 'key-2');
  });
});
