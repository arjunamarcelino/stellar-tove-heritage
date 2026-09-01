import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  WHITELIST_POLL_INTERVAL_MS,
  WHITELIST_POLL_MAX_FAILURES,
  WHITELIST_POLL_BACKOFF_MAX_MS,
} from '@/lib/kyc/constants';
import type { WhitelistStatusResult } from '@/lib/types/api';

const h = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('@/app/actions/kyc', () => ({ refreshWhitelistStatusAction: h.refresh }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }));

import { useWhitelistStatusPolling } from '@/hooks/useWhitelistStatusPolling';

const pending: WhitelistStatusResult = {
  status: 'success',
  data: { status: 'pending_review', lastSubmissionAt: null },
};
const whitelisted: WhitelistStatusResult = {
  status: 'success',
  data: { status: 'whitelisted', whitelistedAt: '2026-07-17T00:00:00Z' },
};
const networkError: WhitelistStatusResult = {
  status: 'error',
  code: 'NETWORK_ERROR',
  message: 'net',
};

const INTERVAL = WHITELIST_POLL_INTERVAL_MS;

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

describe('useWhitelistStatusPolling', () => {
  it('does not poll for a terminal initial state', async () => {
    const { result } = renderHook(() => useWhitelistStatusPolling(whitelisted));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });
    expect(h.refresh).not.toHaveBeenCalled();
    expect(result.current.result).toEqual(whitelisted);
  });

  it('polls while pending and transitions to whitelisted, then stops', async () => {
    h.refresh.mockResolvedValue(whitelisted);
    const { result } = renderHook(() => useWhitelistStatusPolling(pending));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.result).toEqual(whitelisted);

    // Terminal reached — no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('redirects to /login on SESSION_EXPIRED and stops polling', async () => {
    h.refresh.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'x' });
    renderHook(() => useWhitelistStatusPolling(pending));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.replace).toHaveBeenCalledWith('/login');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the last-known state on a transient error and goes degraded after the failure cap', async () => {
    h.refresh.mockResolvedValue(networkError);
    const { result } = renderHook(() => useWhitelistStatusPolling(pending));

    // Advance generously each round so the growing backoff delay always elapses.
    for (let i = 0; i < WHITELIST_POLL_MAX_FAILURES; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WHITELIST_POLL_BACKOFF_MAX_MS);
      });
    }

    expect(h.refresh).toHaveBeenCalledTimes(WHITELIST_POLL_MAX_FAILURES);
    expect(result.current.degraded).toBe(true);
    // Last-known good state stays visible (never overwritten by the error).
    expect(result.current.result).toEqual(pending);
  });

  it('backs off exponentially between consecutive failures (not the fixed interval)', async () => {
    h.refresh.mockResolvedValue(networkError);
    renderHook(() => useWhitelistStatusPolling(pending));

    // First poll fires after the base interval; failure count → 1, next backoff = 5s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);

    // Second poll after another base interval (backoff(1) = 5s); failure count → 2, next backoff = 10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(2);

    // Only base interval elapses — the 10s backoff has NOT yet fired the third poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(2);

    // Completing the 10s backoff fires the third poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(3);
  });

  it('stops polling after unmount', async () => {
    h.refresh.mockResolvedValue(pending);
    const { unmount } = renderHook(() => useWhitelistStatusPolling(pending));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('debounces the un-hide refresh when it fetched within the debounce window', async () => {
    h.refresh.mockResolvedValue(pending);
    renderHook(() => useWhitelistStatusPolling(pending));

    // First poll completes and stamps lastFetchAt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);

    // Hide then immediately un-hide (within the debounce window) — no extra off-cadence poll.
    setHidden(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);

    // The rescheduled tick still fires on cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it('retry() re-arms polling from the degraded state and transitions on recovery', async () => {
    h.refresh.mockResolvedValue(networkError);
    const { result } = renderHook(() => useWhitelistStatusPolling(pending));

    for (let i = 0; i < WHITELIST_POLL_MAX_FAILURES; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WHITELIST_POLL_BACKOFF_MAX_MS);
      });
    }
    expect(result.current.degraded).toBe(true);

    // Endpoint recovers; manual retry re-arms and lands the terminal state.
    h.refresh.mockResolvedValue(whitelisted);
    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.degraded).toBe(false);
    expect(result.current.result).toEqual(whitelisted);
  });

  it('pauses while the tab is hidden and refreshes immediately on un-hide', async () => {
    h.refresh.mockResolvedValue(pending);
    renderHook(() => useWhitelistStatusPolling(pending));

    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    });
    expect(h.refresh).not.toHaveBeenCalled();

    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});
