import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { OFFERING_ID, submittedBid, escrowedBid, failedBid } from '@/test/fixtures/offerings';
import { BID_POLL_INTERVAL_MS, BID_POLL_CAP_MS } from '@/lib/offerings/constants';

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/app/actions/offerings', () => ({ refreshMyBidAction: h.refresh }));

import { useMyBidPolling } from '@/hooks/useMyBidPolling';

// One jittered interval is BID_POLL_INTERVAL_MS ± 15% — advancing by the upper bound always elapses a tick.
const MAX_TICK = Math.ceil(BID_POLL_INTERVAL_MS * 1.15);

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  setHidden(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMyBidPolling', () => {
  it('does not poll (and no mount refetch) for a null or terminal seed', async () => {
    const { result: idle } = renderHook(() => useMyBidPolling(OFFERING_ID, null));
    const { result: settled } = renderHook(() => useMyBidPolling(OFFERING_ID, escrowedBid));
    const { result: failed } = renderHook(() => useMyBidPolling(OFFERING_ID, failedBid));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3);
    });

    expect(h.refresh).not.toHaveBeenCalled();
    expect(idle.current.phase).toBe('idle');
    expect(settled.current.phase).toBe('settled');
    expect(failed.current.phase).toBe('failed');
  });

  it('polls a submitted bid and transitions to settled on escrowed, then stops', async () => {
    h.refresh.mockResolvedValue({ status: 'success', bid: escrowedBid });
    const { result } = renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));
    expect(result.current.phase).toBe('polling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('settled');
    expect(result.current.bid).toEqual(escrowedBid);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1); // terminal — no further polling
  });

  it('transitions to failed on a failed poll result', async () => {
    h.refresh.mockResolvedValue({ status: 'success', bid: failedBid });
    const { result } = renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(result.current.phase).toBe('failed');
    expect(result.current.bid).toEqual(failedBid);
  });

  it('is single-flight: a slow poll never overlaps the next tick', async () => {
    let resolve: (v: unknown) => void = () => {};
    h.refresh.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r as (v: unknown) => void;
        }),
    );
    renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3); // three intervals, but the first poll never resolved
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ status: 'success', bid: submittedBid });
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it('backs off on a transport error and stops in phase error after the failure cap', async () => {
    h.refresh.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'x' });
    const { result } = renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));

    // Backoff grows 3s → 6s → 12s …; advancing generously each round always elapses the delay.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BID_POLL_CAP_MS);
      });
    }
    expect(result.current.phase).toBe('error');
    expect(result.current.bid).toEqual(submittedBid); // last-known bid preserved
  });

  it('caps by active elapsed time and lands in phase timeout', async () => {
    h.refresh.mockResolvedValue({ status: 'success', bid: submittedBid });
    const { result } = renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BID_POLL_CAP_MS + MAX_TICK * 2);
    });
    expect(result.current.phase).toBe('timeout');
  });

  it('stops in phase error on SESSION_EXPIRED and never redirects', async () => {
    h.refresh.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'x' });
    const { result } = renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(result.current.phase).toBe('error');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1); // stopped for good
  });

  it('pauses while hidden and resumes on un-hide', async () => {
    h.refresh.mockResolvedValue({ status: 'success', bid: submittedBid });
    renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));

    setHidden(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3);
    });
    expect(h.refresh).not.toHaveBeenCalled();

    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not reschedule into the background when hidden mid-flight (todo 147)', async () => {
    let resolve: (v: unknown) => void = () => {};
    h.refresh.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r as (v: unknown) => void;
        }),
    );
    renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));

    // Fire the first poll — it's in flight (unresolved).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);

    // Hide the tab WHILE that poll is still in flight.
    setHidden(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    // Resolve it: the success path must NOT re-arm a timer while hidden (previously it polled forever).
    await act(async () => {
      resolve({ status: 'success', bid: submittedBid });
      await vi.advanceTimersByTimeAsync(MAX_TICK * 5);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('re-arms polling from a terminal phase via refresh()', async () => {
    h.refresh.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'x' });
    const { result } = renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(result.current.phase).toBe('error');

    h.refresh.mockResolvedValue({ status: 'success', bid: escrowedBid });
    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe('settled');
  });

  it('stops polling after unmount', async () => {
    h.refresh.mockResolvedValue({ status: 'success', bid: submittedBid });
    const { unmount } = renderHook(() => useMyBidPolling(OFFERING_ID, submittedBid));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TICK * 3);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});
