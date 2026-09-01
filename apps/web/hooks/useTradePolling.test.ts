import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { RFQ_ID, pendingTrade, settledTrade, failedTrade } from '@/test/fixtures/accept';
import { ACCEPT_POLL_STAGES, ACCEPT_POLL_MAX_FAILURES } from '@/lib/accept/constants';
import type { MyTradeResult } from '@/lib/types/api';

import { useTradePolling } from '@/hooks/useTradePolling';

// The poll now fetches a GET route handler (todo 177) — stub global fetch to return a MyTradeResult body (the
// route replies 200 with the discriminated result inside, including error results).
const h = { result: { status: 'success', trade: null } as MyTradeResult };
let fetchFn: ReturnType<typeof vi.fn>;

// One jittered first-stage interval is stage0 ± 15% — advancing by the upper bound always elapses a tick.
const MAX_TICK = Math.ceil(ACCEPT_POLL_STAGES[0]!.intervalMs * 1.15);

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Pin the clock just after the fixture trade's createdAt so pendingTrade reads as "fresh" (3s stage); the
  // trade-age seeding (todo 183) otherwise makes the fixed-date fixture read as hours-old.
  vi.setSystemTime(new Date('2026-08-22T10:00:31.000Z'));
  setHidden(false);
  fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => h.result }));
  vi.stubGlobal('fetch', fetchFn);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useTradePolling', () => {
  it('does not poll for a null or terminal seed', async () => {
    const { result: idle } = renderHook(() => useTradePolling(RFQ_ID, null));
    const { result: settled } = renderHook(() => useTradePolling(RFQ_ID, settledTrade));
    const { result: failed } = renderHook(() =>
      useTradePolling(RFQ_ID, failedTrade('invalid_trade')),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3);
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(idle.current.phase).toBe('idle');
    expect(settled.current.phase).toBe('settled');
    expect(failed.current.phase).toBe('failed');
  });

  it('polls a pending trade and transitions to settled, then stops', async () => {
    h.result = { status: 'success', trade: settledTrade };
    const { result } = renderHook(() => useTradePolling(RFQ_ID, pendingTrade));
    expect(result.current.phase).toBe('polling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(result.current.phase).toBe('settled');
    expect(result.current.trade).toEqual(settledTrade);

    const calls = fetchFn.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 5);
    });
    expect(fetchFn.mock.calls.length).toBe(calls); // stopped
  });

  it('transitions to failed carrying the failureReason, then stops', async () => {
    h.result = { status: 'success', trade: failedTrade('seller_lockup') };
    const { result } = renderHook(() => useTradePolling(RFQ_ID, pendingTrade));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(result.current.phase).toBe('failed');
    expect(result.current.trade?.failureReason).toBe('seller_lockup');
  });

  it('NO hard timeout: a prolonged pending keeps polling (never a false terminal)', async () => {
    h.result = { status: 'success', trade: pendingTrade };
    const { result } = renderHook(() => useTradePolling(RFQ_ID, pendingTrade));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000); // 10 minutes
    });
    expect(result.current.phase).toBe('polling'); // still polling, no cap/timeout
    expect(fetchFn.mock.calls.length).toBeGreaterThan(5);
  });

  it('stops on SESSION_EXPIRED without redirect, and never polls again', async () => {
    h.result = { status: 'error', code: 'SESSION_EXPIRED', message: 'x' };
    const { result } = renderHook(() => useTradePolling(RFQ_ID, pendingTrade));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(result.current.phase).toBe('error');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 5);
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('backs off on transport failures and stops after the max-failures cap', async () => {
    h.result = { status: 'error', code: 'NETWORK_ERROR', message: 'x' };
    const { result } = renderHook(() => useTradePolling(RFQ_ID, pendingTrade));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(result.current.phase).toBe('error');
    expect(fetchFn).toHaveBeenCalledTimes(ACCEPT_POLL_MAX_FAILURES);
  });

  it('resumes at the escalated (slow) interval for an old pending trade (todo 183)', async () => {
    // createdAt 6 minutes before "now" → past the 5-min stage → 20s heartbeat, not the 3s fast stage.
    const oldTrade = { ...pendingTrade, createdAt: '2026-08-22T09:54:31.000Z' };
    h.result = { status: 'success', trade: pendingTrade };
    renderHook(() => useTradePolling(RFQ_ID, oldTrade));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK); // ~3.45s — a fresh trade would have polled by now
    });
    expect(fetchFn).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchFn).toHaveBeenCalled();
  });

  it('does not poll while the tab is hidden', async () => {
    setHidden(true);
    h.result = { status: 'success', trade: pendingTrade };
    renderHook(() => useTradePolling(RFQ_ID, pendingTrade));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3);
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
