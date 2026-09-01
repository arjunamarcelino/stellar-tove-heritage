import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown } from '@/hooks/useCountdown';

const START = new Date('2026-08-20T10:00:00.000Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCountdown', () => {
  it('seeds from the real clock in the effect and breaks the remaining time into parts', () => {
    // target 1d 2h 3m 4s out
    const target = new Date(START + ((1 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000).toISOString();
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current).toMatchObject({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
      expired: false,
    });
  });

  it('ticks down once per second, aligned to whole-second boundaries', () => {
    const target = new Date(START + 5000).toISOString();
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.seconds).toBe(5);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.seconds).toBe(4);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.seconds).toBe(2);
  });

  it('re-aligns the first tick to the next whole second when mounted mid-second', () => {
    vi.setSystemTime(START + 300); // 300ms into the second
    const target = new Date(START + 10_000).toISOString();
    const { result } = renderHook(() => useCountdown(target));

    // 700ms lands exactly on the whole-second boundary → one tick fires.
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current.seconds).toBe(9);
  });

  it('stops ticking once expired and freezes at zero', () => {
    const target = new Date(START + 2000).toISOString();
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.expired).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toMatchObject({ expired: true, totalMs: 0, seconds: 0 });
    // No further wakeups scheduled after expiry.
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.expired).toBe(true);
  });

  it('clears its timer on unmount', () => {
    const target = new Date(START + 30_000).toISOString();
    const { unmount } = renderHook(() => useCountdown(target));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
