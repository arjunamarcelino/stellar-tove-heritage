import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the engine's I/O but keep the pure reserve helpers real (importActual). Mock both wallet wrappers
// to the same stubs (the hook lazy-imports one of them).
const h = vi.hoisted(() => ({
  loadAccountState: vi.fn(),
  build: vi.fn(),
  submit: vi.fn(),
  poll: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock('@/lib/stellar/trustline', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/stellar/trustline')>();
  return {
    ...actual, // keep trustlineReserveShortfall / stroopsToXlm real
    loadAccountState: h.loadAccountState,
    buildChangeTrustXdr: h.build,
    submitSignedTransaction: h.submit,
    pollTransaction: h.poll,
  };
});
vi.mock('@/lib/wallet/freighter', () => ({
  freighterProvider: { getPublicKey: h.getPublicKey, signTransaction: h.signTransaction },
}));
vi.mock('@/lib/wallet/albedo', () => ({
  albedoProvider: { getPublicKey: h.getPublicKey, signTransaction: h.signTransaction },
}));

import { useWalletTrustline } from '@/hooks/useWalletTrustline';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'; // matches PLATFORM_USDC (testnet)
const ADDRESS = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const ASSET = { code: 'USDC', issuer: ISSUER };

function fundedMissing(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'funded',
    sequence: '100',
    subentryCount: 0,
    nativeBalance: '5',
    sellingLiabilities: '0',
    usdcLine: 'missing',
    ...overrides,
  };
}

function render(pollIntervalMs = 0) {
  return renderHook(() => useWalletTrustline({ address: ADDRESS, asset: ASSET, pollIntervalMs }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getPublicKey.mockResolvedValue({ status: 'success', data: ADDRESS });
  h.signTransaction.mockResolvedValue({ status: 'success', data: 'SIGNED' });
  h.build.mockResolvedValue('XDR');
  h.loadAccountState.mockResolvedValue(fundedMissing());
  h.submit.mockResolvedValue({ kind: 'confirmed', hash: 'HASH' });
  h.poll.mockResolvedValue('confirmed');
});

describe('useWalletTrustline — gate + precheck', () => {
  it('lands in readyToSign when funded, on-account, and reserve is sufficient', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.start('freighter');
    });
    expect(result.current.state).toEqual({ status: 'readyToSign', asset: ASSET });
  });

  it('blockedGate ACCOUNT_MISMATCH when the wallet is on a different account', async () => {
    h.getPublicKey.mockResolvedValue({ status: 'success', data: 'GOTHERADDRESS' });
    const { result } = render();
    await act(async () => {
      await result.current.start('freighter');
    });
    expect(result.current.state).toMatchObject({ status: 'blockedGate', code: 'ACCOUNT_MISMATCH' });
    expect(h.loadAccountState).not.toHaveBeenCalled();
  });

  it('blockedGate ISSUER_MISMATCH when the asset issuer differs from the env anchor', async () => {
    const { result } = renderHook(() =>
      useWalletTrustline({ address: ADDRESS, asset: { code: 'USDC', issuer: 'GEVIL' } }),
    );
    await act(async () => {
      await result.current.start('freighter');
    });
    expect(result.current.state).toMatchObject({ status: 'blockedGate', code: 'ISSUER_MISMATCH' });
    expect(h.getPublicKey).not.toHaveBeenCalled();
  });

  it('blockedUnfunded when the account does not exist on-chain', async () => {
    h.loadAccountState.mockResolvedValue({ status: 'unfunded' });
    const { result } = render();
    await act(async () => {
      await result.current.start('freighter');
    });
    expect(result.current.state).toEqual({ status: 'blockedUnfunded', address: ADDRESS });
  });

  it('blockedLowReserve with the exact shortfall when below the post-trustline minimum', async () => {
    h.loadAccountState.mockResolvedValue(fundedMissing({ nativeBalance: '1' }));
    const { result } = render();
    await act(async () => {
      await result.current.start('freighter');
    });
    // 0 subentries: minAfter 1.5 XLM + 100 stroops fee; balance 1 → short 0.5 XLM + fee = 0.50001 XLM.
    expect(result.current.state).toEqual({ status: 'blockedLowReserve', shortfallXlm: '0.50001' });
  });

  it('goes straight to success when the account already trusts USDC (no-op)', async () => {
    h.loadAccountState.mockResolvedValue(fundedMissing({ usdcLine: 'active' }));
    const { result } = render();
    await act(async () => {
      await result.current.start('freighter');
    });
    expect(result.current.state).toEqual({ status: 'success' });
  });

  it('fails open to HORIZON_UNAVAILABLE when the read fails', async () => {
    h.loadAccountState.mockResolvedValue({ status: 'horizonUnavailable' });
    const { result } = render();
    await act(async () => {
      await result.current.start('freighter');
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'HORIZON_UNAVAILABLE' });
  });
});

describe('useWalletTrustline — sign + submit', () => {
  async function toReady(result: { current: ReturnType<typeof useWalletTrustline> }) {
    await act(async () => {
      await result.current.start('freighter');
    });
    expect(result.current.state.status).toBe('readyToSign');
  }

  it('confirms on the happy path', async () => {
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toEqual({ status: 'success', hash: 'HASH' });
    expect(h.build).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ADDRESS, sequence: '100', asset: ASSET }),
    );
  });

  it('returns to readyToSign when the user cancels signing', async () => {
    h.signTransaction.mockResolvedValue({ status: 'error', code: 'USER_CANCELLED', message: 'x' });
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state.status).toBe('readyToSign');
  });

  it('maps a popup-blocked wallet error to a retry-sign error', async () => {
    h.signTransaction.mockResolvedValue({ status: 'error', code: 'POPUP_BLOCKED', message: 'x' });
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({
      status: 'error',
      code: 'POPUP_BLOCKED',
      recovery: 'retry-sign',
    });
  });

  it("maps the wrappers' catch-all NETWORK_ERROR to a retryable (retry-sign) error, not terminal", async () => {
    h.signTransaction.mockResolvedValue({ status: 'error', code: 'NETWORK_ERROR', message: 'x' });
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'retry-sign' });
  });

  it('retry() re-drives the sign flow after a retryable error (button is not inert)', async () => {
    h.signTransaction
      .mockResolvedValueOnce({ status: 'error', code: 'POPUP_BLOCKED', message: 'x' })
      .mockResolvedValue({ status: 'success', data: 'SIGNED' });
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', recovery: 'retry-sign' });
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state).toEqual({ status: 'success', hash: 'HASH' });
  });

  it('rebuilds + re-signs on tx_bad_seq, then confirms', async () => {
    h.submit
      .mockResolvedValueOnce({ kind: 'rebuild', cause: 'tx_bad_seq' })
      .mockResolvedValueOnce({ kind: 'confirmed', hash: 'HASH2' });
    h.loadAccountState
      .mockResolvedValueOnce(fundedMissing())
      .mockResolvedValueOnce(fundedMissing({ sequence: '101' }));
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toEqual({ status: 'success', hash: 'HASH2' });
    expect(h.submit).toHaveBeenCalledTimes(2);
  });

  it('gives up with REBUILD_EXHAUSTED after repeated tx_bad_seq', async () => {
    h.submit.mockResolvedValue({ kind: 'rebuild', cause: 'tx_bad_seq' });
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'REBUILD_EXHAUSTED' });
  });

  it('re-derives funding on a submit-time low reserve', async () => {
    h.submit.mockResolvedValue({ kind: 'lowReserve' });
    h.loadAccountState
      .mockResolvedValueOnce(fundedMissing())
      .mockResolvedValueOnce(fundedMissing({ nativeBalance: '1' }));
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'blockedLowReserve' });
  });

  it('surfaces blockedGate ACCOUNT_MISMATCH when submit returns accountMismatch (tx_bad_auth)', async () => {
    h.submit.mockResolvedValue({ kind: 'accountMismatch' });
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'blockedGate', code: 'ACCOUNT_MISMATCH' });
  });

  it('confirms via the poll path when submit returns pending', async () => {
    h.submit.mockResolvedValue({ kind: 'pending', hash: 'PHASH' });
    h.poll.mockResolvedValue('confirmed');
    const { result } = render();
    await toReady(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toEqual({ status: 'success', hash: 'PHASH' });
  });

  it('reset returns to idle', async () => {
    const { result } = render();
    await toReady(result);
    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toEqual({ status: 'idle' });
  });
});
