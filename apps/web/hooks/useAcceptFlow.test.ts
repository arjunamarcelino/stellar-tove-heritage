import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let keyN = 0;
const h = vi.hoisted(() => ({
  prepareAcceptAction: vi.fn(),
  submitAcceptAction: vi.fn(),
  pollMyTradeAction: vi.fn(),
  startPasskeyAssertion: vi.fn(),
}));

vi.mock('@/app/actions/accept', () => ({
  prepareAcceptAction: h.prepareAcceptAction,
  submitAcceptAction: h.submitAcceptAction,
  pollMyTradeAction: h.pollMyTradeAction,
}));
vi.mock('@/lib/webauthn/passkey', () => ({
  startPasskeyAssertion: h.startPasskeyAssertion,
  buildAssertionOptions: (x: unknown) => x,
}));
vi.mock('@/lib/idempotency', () => ({ mintIdempotencyKey: () => `key-${++keyN}` }));

import { useAcceptFlow } from '@/hooks/useAcceptFlow';
import {
  RFQ_ID,
  openQuote,
  prepareAcceptData,
  assertionResponse,
  pendingTrade,
} from '@/test/fixtures/accept';

const prepareOk = { status: 'success' as const, data: prepareAcceptData };
const submitOk = {
  status: 'success' as const,
  tradeId: 'trade-1',
  tradeStatus: 'pending' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  keyN = 0;
  h.startPasskeyAssertion.mockResolvedValue(assertionResponse);
});

async function prepare(result: { current: ReturnType<typeof useAcceptFlow> }) {
  await act(async () => {
    await result.current.acceptQuote(RFQ_ID, openQuote);
  });
}

describe('useAcceptFlow — two-gesture ceremony', () => {
  it('prepare does NOT fire the passkey; sign fires it exactly once', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    h.submitAcceptAction.mockResolvedValue(submitOk);
    const { result } = renderHook(() => useAcceptFlow());

    await prepare(result);
    expect(result.current.state.status).toBe('readyToSign');
    expect(h.startPasskeyAssertion).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.sign();
    });
    expect(h.startPasskeyAssertion).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: 'submitted' });
  });

  it('reuses the same idempotency key for prepare and submit', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    h.submitAcceptAction.mockResolvedValue(submitOk);
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    await act(async () => {
      await result.current.sign();
    });
    const prepKey = h.prepareAcceptAction.mock.calls[0][2];
    const subKey = h.submitAcceptAction.mock.calls[0][2];
    expect(subKey).toBe(prepKey);
  });

  it('SEC-5: a gross mismatch → staleQuote and never signs', async () => {
    h.prepareAcceptAction.mockResolvedValue({
      status: 'success',
      data: { ...prepareAcceptData, trade: { ...prepareAcceptData.trade, grossStroops: '999' } },
    });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    expect(result.current.state.status).toBe('staleQuote');

    await act(async () => {
      await result.current.sign();
    });
    expect(h.startPasskeyAssertion).not.toHaveBeenCalled();
  });

  it('passkey cancel → back to readyToSign (recoverable, no error)', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    h.startPasskeyAssertion.mockResolvedValue({ status: 'cancelled' });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state.status).toBe('readyToSign');
  });

  it('lost submit (NETWORK_ERROR) → exactly one reconcile read, adopts the trade', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    h.submitAcceptAction.mockResolvedValue({
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'x',
    });
    h.pollMyTradeAction.mockResolvedValue({ status: 'success', trade: pendingTrade });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(h.pollMyTradeAction).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: 'submitted' });
  });

  it('SERVER_ERROR at submit (incl. a 2xx with an unparseable body) → reconcile-once, key retained (todo 175)', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    h.submitAcceptAction.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'x' });
    h.pollMyTradeAction.mockResolvedValue({ status: 'success', trade: pendingTrade });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    await act(async () => {
      await result.current.sign();
    });
    // Reconciled once, adopted the trade — NOT re-prepared with a fresh key.
    expect(h.pollMyTradeAction).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: 'submitted' });
  });

  it('SERVER_ERROR at submit with no trade found → recheck (safe, no blind resubmit)', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    h.submitAcceptAction.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'x' });
    h.pollMyTradeAction.mockResolvedValue({ status: 'success', trade: null });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state.status).toBe('recheck');
  });

  it('TRADE_ALREADY_IN_FLIGHT at submit → reconcile and adopt', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    h.submitAcceptAction.mockResolvedValue({
      status: 'error',
      code: 'TRADE_ALREADY_IN_FLIGHT',
      message: 'x',
    });
    h.pollMyTradeAction.mockResolvedValue({ status: 'success', trade: pendingTrade });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.state).toMatchObject({ status: 'submitted' });
  });

  it('busyRef single-flights a double acceptQuote (one prepare)', async () => {
    h.prepareAcceptAction.mockResolvedValue(prepareOk);
    const { result } = renderHook(() => useAcceptFlow());
    await act(async () => {
      await Promise.all([
        result.current.acceptQuote(RFQ_ID, openQuote),
        result.current.acceptQuote(RFQ_ID, openQuote),
      ]);
    });
    expect(h.prepareAcceptAction).toHaveBeenCalledTimes(1);
  });
});

describe('useAcceptFlow — prepare-time error dispositions', () => {
  it('ACCEPT_INSUFFICIENT_USDC → insufficientUsdc with required/available', async () => {
    h.prepareAcceptAction.mockResolvedValue({
      status: 'error',
      code: 'ACCEPT_INSUFFICIENT_USDC',
      message: 'x',
      requiredStroops: '10',
      availableStroops: '5',
    });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    expect(result.current.state).toMatchObject({
      status: 'insufficientUsdc',
      required: '10',
      available: '5',
    });
  });

  it('ACCEPT_NOT_WHITELISTED → notWhitelisted', async () => {
    h.prepareAcceptAction.mockResolvedValue({
      status: 'error',
      code: 'ACCEPT_NOT_WHITELISTED',
      message: 'x',
    });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    expect(result.current.state.status).toBe('notWhitelisted');
  });

  it('ACCEPT_QUOTE_NOT_AUTHORIZED → staleQuote', async () => {
    h.prepareAcceptAction.mockResolvedValue({
      status: 'error',
      code: 'ACCEPT_QUOTE_NOT_AUTHORIZED',
      message: 'x',
    });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    expect(result.current.state.status).toBe('staleQuote');
  });

  it('SESSION_EXPIRED → sessionExpired', async () => {
    h.prepareAcceptAction.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'x',
    });
    const { result } = renderHook(() => useAcceptFlow());
    await prepare(result);
    expect(result.current.state.status).toBe('sessionExpired');
  });
});
