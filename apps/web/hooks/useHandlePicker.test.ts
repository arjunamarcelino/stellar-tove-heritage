import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CheckHandleResult } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  checkHandle: vi.fn(),
  setHandleAction: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/lib/handle/checkHandle', () => ({ checkHandle: h.checkHandle }));
vi.mock('@/app/actions/handle', () => ({ setHandleAction: h.setHandleAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }));

import { useHandlePicker } from '@/hooks/useHandlePicker';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  h.checkHandle.mockResolvedValue({ status: 'available' });
  h.setHandleAction.mockResolvedValue({ status: 'success', handle: 'jane', handleCanonical: 'jane' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useHandlePicker', () => {
  it('starts idle and rejects invalid input without a network check', () => {
    const { result } = renderHook(() => useHandlePicker());
    expect(result.current.state).toEqual({ status: 'idle' });
    act(() => result.current.onChange('a'));
    expect(result.current.state.status).toBe('invalid');
    expect(h.checkHandle).not.toHaveBeenCalled();
  });

  it('debounces a valid value and fires the check exactly once', async () => {
    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('jane'));
    expect(result.current.state).toEqual({ status: 'debouncing' });
    expect(h.checkHandle).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(h.checkHandle).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'available' });
  });

  it('drops a stale (superseded) check result — an aborted NETWORK_ERROR never surfaces', async () => {
    const jan = deferred<CheckHandleResult>();
    const jane = deferred<CheckHandleResult>();
    h.checkHandle.mockReturnValueOnce(jan.promise).mockReturnValueOnce(jane.promise);

    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('jan'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    }); // runCheck('jan') in flight

    act(() => result.current.onChange('jane')); // bumps seq + aborts 'jan'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    }); // runCheck('jane') in flight

    await act(async () => {
      jane.resolve({ status: 'available' });
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: 'available' });

    // The stale 'jan' resolves late with an error — it must be dropped, not shown.
    await act(async () => {
      jan.resolve({ status: 'error', code: 'NETWORK_ERROR' });
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: 'available' });
  });

  it('surfaces a genuine transport error on the current value', async () => {
    h.checkHandle.mockResolvedValue({ status: 'error', code: 'NETWORK_ERROR' });
    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('jane'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
  });

  it('maps an unavailable verdict and reuses it from cache without re-checking', async () => {
    h.checkHandle.mockResolvedValue({ status: 'unavailable', reason: 'taken' });
    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('taken1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.state).toMatchObject({ status: 'unavailable', reason: 'taken' });

    act(() => result.current.onChange('other'));
    act(() => result.current.onChange('taken1')); // back to a verdicted value
    expect(result.current.state).toMatchObject({ status: 'unavailable', reason: 'taken' });
    expect(h.checkHandle).toHaveBeenCalledTimes(1); // no second network check
  });

  it('clearing the field aborts any pending check and returns to idle', async () => {
    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('jane'));
    expect(result.current.state).toEqual({ status: 'debouncing' });
    act(() => result.current.onChange(''));
    expect(result.current.state).toEqual({ status: 'idle' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(h.checkHandle).not.toHaveBeenCalled();
  });

  it('commits an available handle and re-shows taken on a 409 TOCTOU race', async () => {
    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('jane'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.state).toEqual({ status: 'available' });

    h.setHandleAction.mockResolvedValue({ status: 'error', code: 'HANDLE_TAKEN', message: 'taken' });
    await act(async () => {
      await result.current.submit();
    });
    expect(h.setHandleAction).toHaveBeenCalledWith('jane');
    expect(result.current.state).toMatchObject({ status: 'unavailable', reason: 'taken' });
  });

  it('navigates to the onboarding destination if a commit succeeds without redirecting', async () => {
    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('jane'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    // Default setHandleAction resolves success (the redirect can't throw through a mock) → the hook's
    // client-nav fallback must fire so the user isn't stranded in `submitting`.
    await act(async () => {
      await result.current.submit();
    });
    expect(h.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('busyRef prevents a double-submit', async () => {
    const pending = deferred<{ status: string }>();
    h.setHandleAction.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useHandlePicker());
    act(() => result.current.onChange('jane'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    await act(async () => {
      void result.current.submit();
      void result.current.submit();
      await Promise.resolve();
    });
    expect(h.setHandleAction).toHaveBeenCalledTimes(1);
  });
});
