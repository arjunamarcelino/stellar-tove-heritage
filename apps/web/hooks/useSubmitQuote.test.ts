import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSubmitQuote } from '@/hooks/useSubmitQuote';
import { RFQ_ID, quoteInput, quote } from '@/test/fixtures/quote';
import type { SubmitQuoteAction, SubmitQuoteResult } from '@/lib/types/api';

const success: SubmitQuoteResult = { status: 'success', quote };
const inFlightErr: SubmitQuoteResult = {
  status: 'error',
  code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
  message: 'in flight',
};
const mismatchErr: SubmitQuoteResult = {
  status: 'error',
  code: 'IDEMPOTENCY_KEY_MISMATCH',
  message: 'mismatch',
};
const insufficientErr: SubmitQuoteResult = {
  status: 'error',
  code: 'QUOTE_INSUFFICIENT_FREE_BALANCE',
  message: 'not enough',
  balanceDetail: { requiredFractionCount: '25', freeFractionCount: '5' },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function keyOf(action: SubmitQuoteAction, call: number): string {
  return (action as ReturnType<typeof vi.fn>).mock.calls[call][2];
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useSubmitQuote', () => {
  it('submit → created on a 201', async () => {
    const action: SubmitQuoteAction = vi.fn().mockResolvedValue(success);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    expect(result.current.state.status).toBe('submitting');
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    expect(result.current.state).toEqual({ status: 'created', quote });
    expect(action).toHaveBeenCalledWith(RFQ_ID, quoteInput, expect.any(String));
  });

  it('surfaces a non-201 as an error arm, carrying balanceDetail for INSUFFICIENT', async () => {
    const action: SubmitQuoteAction = vi.fn().mockResolvedValue(insufficientErr);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({
      code: 'QUOTE_INSUFFICIENT_FREE_BALANCE',
      balanceDetail: { requiredFractionCount: '25', freeFractionCount: '5' },
    });
  });

  it('a thrown action degrades to SERVER_ERROR, never stranding at submitting', async () => {
    const action: SubmitQuoteAction = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('single-flights: a second submit while in flight does not fire a second call', async () => {
    const d = deferred<SubmitQuoteResult>();
    const action: SubmitQuoteAction = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    act(() => result.current.submit(quoteInput)); // ignored — busyRef
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve(success);
      await d.promise;
    });
  });

  it('retry after a 409 IN_FLIGHT reuses the SAME idempotency key', async () => {
    const action: SubmitQuoteAction = vi
      .fn()
      .mockResolvedValueOnce(inFlightErr)
      .mockResolvedValueOnce(success);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    expect(keyOf(action, 1)).toBe(keyOf(action, 0));
  });

  it('retry after a 503 BALANCE_UNAVAILABLE reuses the SAME key (transient class)', async () => {
    const action: SubmitQuoteAction = vi
      .fn()
      .mockResolvedValueOnce({ status: 'error', code: 'QUOTE_BALANCE_UNAVAILABLE', message: 'x' })
      .mockResolvedValueOnce(success);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    expect(keyOf(action, 1)).toBe(keyOf(action, 0));
  });

  it('retry after a 422 MISMATCH mints a FRESH idempotency key', async () => {
    const action: SubmitQuoteAction = vi
      .fn()
      .mockResolvedValueOnce(mismatchErr)
      .mockResolvedValueOnce(success);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    expect(keyOf(action, 1)).not.toBe(keyOf(action, 0));
  });

  it('C2: resubmit after INSUFFICIENT via submit() mints a FRESH key even with an unchanged body', async () => {
    const action: SubmitQuoteAction = vi
      .fn()
      .mockResolvedValueOnce(insufficientErr)
      .mockResolvedValueOnce(success);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.submit(quoteInput)); // same body, via the form button → fresh key
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    expect(keyOf(action, 1)).not.toBe(keyOf(action, 0));
  });

  it('reset returns to idle and the next submit mints a fresh key', async () => {
    const action: SubmitQuoteAction = vi.fn().mockResolvedValue(success);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    act(() => result.current.reset());
    expect(result.current.state.status).toBe('idle');
    act(() => result.current.submit(quoteInput));
    await waitFor(() => expect(result.current.state.status).toBe('created'));
    expect(keyOf(action, 1)).not.toBe(keyOf(action, 0));
  });

  it('epoch guard: a superseded in-flight response (reset mid-flight) is dropped', async () => {
    const d = deferred<SubmitQuoteResult>();
    const action: SubmitQuoteAction = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() => useSubmitQuote(RFQ_ID, action));
    act(() => result.current.submit(quoteInput));
    act(() => result.current.reset()); // supersedes the in-flight submit
    await act(async () => {
      d.resolve(success);
      await d.promise;
    });
    expect(result.current.state.status).toBe('idle'); // NOT 'created'
  });
});
