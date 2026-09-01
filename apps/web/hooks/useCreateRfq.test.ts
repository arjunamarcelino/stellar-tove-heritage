import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCreateRfq } from '@/hooks/useCreateRfq';
import { ARTWORK_ID, rfqInput, rfq } from '@/test/fixtures/rfq';
import type { CreateRfqAction, CreateRfqResult } from '@/lib/types/api';

const success: CreateRfqResult = { status: 'success', rfq };
const inFlightErr: CreateRfqResult = {
  status: 'error',
  code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
  message: 'in flight',
};
const mismatchErr: CreateRfqResult = {
  status: 'error',
  code: 'IDEMPOTENCY_KEY_MISMATCH',
  message: 'mismatch',
};

// A deferred so a test can hold the action in flight and resolve it deterministically.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useCreateRfq', () => {
  it('submit → created on a 201', async () => {
    const action: CreateRfqAction = vi.fn().mockResolvedValue(success);
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    expect(result.current.state.status).toBe('submitting');
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    expect(result.current.state).toEqual({ status: 'created', rfq });
    expect(action).toHaveBeenCalledWith(ARTWORK_ID, rfqInput, expect.any(String));
  });

  it('surfaces a non-201 as an error arm', async () => {
    const action: CreateRfqAction = vi.fn().mockResolvedValue({
      status: 'error',
      code: 'RFQ_TOO_MANY_ACTIVE',
      message: 'max',
    });
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ code: 'RFQ_TOO_MANY_ACTIVE' });
  });

  it('a thrown action degrades to SERVER_ERROR, never stranding at submitting', async () => {
    const action: CreateRfqAction = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('single-flights: a second submit while in flight does not fire a second call', async () => {
    const d = deferred<CreateRfqResult>();
    const action: CreateRfqAction = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    act(() => result.current.submit(rfqInput)); // ignored — busyRef
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve(success);
      await d.promise;
    });
  });

  it('retry after a 409 IN_FLIGHT reuses the SAME idempotency key', async () => {
    const action: CreateRfqAction = vi
      .fn()
      .mockResolvedValueOnce(inFlightErr)
      .mockResolvedValueOnce(success);
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    const keyA = (action as ReturnType<typeof vi.fn>).mock.calls[0][2];
    const keyB = (action as ReturnType<typeof vi.fn>).mock.calls[1][2];
    expect(keyB).toBe(keyA);
  });

  it('retry after a 422 MISMATCH mints a FRESH idempotency key', async () => {
    const action: CreateRfqAction = vi
      .fn()
      .mockResolvedValueOnce(mismatchErr)
      .mockResolvedValueOnce(success);
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    const keyA = (action as ReturnType<typeof vi.fn>).mock.calls[0][2];
    const keyB = (action as ReturnType<typeof vi.fn>).mock.calls[1][2];
    expect(keyB).not.toBe(keyA);
  });

  it('makeAnother resets to idle with a fresh key on the next submit', async () => {
    const action: CreateRfqAction = vi.fn().mockResolvedValue(success);
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    act(() => result.current.makeAnother());
    expect(result.current.state.status).toBe('idle');
    act(() => result.current.submit(rfqInput));
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    const keyA = (action as ReturnType<typeof vi.fn>).mock.calls[0][2];
    const keyB = (action as ReturnType<typeof vi.fn>).mock.calls[1][2];
    expect(keyB).not.toBe(keyA);
  });

  it('epoch guard: a superseded in-flight response (makeAnother mid-flight) is dropped', async () => {
    const d = deferred<CreateRfqResult>();
    const action: CreateRfqAction = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput));
    act(() => result.current.makeAnother()); // supersedes the in-flight submit
    await act(async () => {
      d.resolve(success);
      await d.promise;
    });
    expect(result.current.state.status).toBe('idle'); // NOT 'created'
  });

  it('makeAnother mid-flight releases busyRef so a fresh submit is not swallowed', async () => {
    const d = deferred<CreateRfqResult>();
    const action: CreateRfqAction = vi
      .fn()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValue(success);
    const { result } = renderHook(() => useCreateRfq(ARTWORK_ID, action));
    act(() => result.current.submit(rfqInput)); // call 1 — in flight
    act(() => result.current.makeAnother()); // reset + release busyRef
    act(() => result.current.submit(rfqInput)); // call 2 — must fire, not be swallowed
    expect(action).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    // The superseded first request settling must not clobber the fresh submit's latch.
    await act(async () => {
      d.resolve(success);
      await d.promise;
    });
    expect(result.current.state.status).toBe('created');
  });
});
