import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { OFFERING_ID, prepareData, submittedBid } from '@/test/fixtures/offerings';
import { fakeAssertionResponse } from '@/test/fixtures/passkey';
import type { BidInput } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  prepare: vi.fn(),
  submit: vi.fn(),
  refresh: vi.fn(),
  assert: vi.fn(),
}));

vi.mock('@/app/actions/offerings', () => ({
  prepareBidAction: h.prepare,
  submitBidAction: h.submit,
  refreshMyBidAction: h.refresh,
}));
vi.mock('@/lib/webauthn/passkey', () => ({
  startPasskeyAssertion: h.assert,
  buildAssertionOptions: vi.fn((p) => p), // pure assembler — pass-through, the hook forwards it to the mock
}));

import { useBidFlow } from '@/hooks/useBidFlow';

// price 100M stroops × count 10 → escrow 1,000M stroops (= prepareData.escrowAmountStroops) — the SEC-5 gate
// passes by default.
const input: BidInput = { price: '100000000', count: 10 };

function mount() {
  return renderHook(() => useBidFlow());
}

type Hook = ReturnType<typeof mount>['result'];

async function place(result: Hook) {
  await act(async () => {
    await result.current.placeBid(OFFERING_ID, input);
  });
}

async function sign(result: Hook) {
  await act(async () => {
    await result.current.sign();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.prepare.mockResolvedValue({ status: 'success', data: prepareData });
  h.assert.mockResolvedValue({ status: 'success', response: fakeAssertionResponse });
  h.submit.mockResolvedValue({ status: 'success', bid: submittedBid });
  h.refresh.mockResolvedValue({ status: 'success', bid: submittedBid });
});

describe('useBidFlow', () => {
  it('starts idle', () => {
    const { result } = mount();
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('is single-flight: a double placeBid fires exactly one prepare (AC-14)', async () => {
    const { result } = mount();
    await act(async () => {
      const p1 = result.current.placeBid(OFFERING_ID, input);
      const p2 = result.current.placeBid(OFFERING_ID, input);
      await Promise.all([p1, p2]);
    });
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('readyToSign');
  });

  it('prepares then reaches readyToSign on the happy path', async () => {
    const { result } = mount();
    await place(result);
    expect(result.current.state).toEqual({ status: 'readyToSign', data: prepareData });
    // prepare carried a uuid idempotency key.
    expect(typeof h.prepare.mock.calls[0]?.[2]).toBe('string');
  });

  it('routes BID_INSUFFICIENT_BALANCE to insufficientBalance and never signs (AC-3)', async () => {
    h.prepare.mockResolvedValue({
      status: 'error',
      code: 'BID_INSUFFICIENT_BALANCE',
      message: 'raw',
      required: '1000000000',
      available: '5000000',
    });
    const { result } = mount();
    await place(result);
    expect(result.current.state).toMatchObject({
      status: 'insufficientBalance',
      required: '1000000000',
      available: '5000000',
    });
    await sign(result); // no-op from a non-ready state
    expect(h.assert).not.toHaveBeenCalled();
  });

  it('does NOT sign when the client preview diverges from the server quote (SEC-5)', async () => {
    h.prepare.mockResolvedValue({
      status: 'success',
      data: { ...prepareData, escrowAmountStroops: '999' },
    });
    const { result } = mount();
    await place(result);
    expect(result.current.state).toMatchObject({ status: 'error', retry: 'reprepare' });
    await sign(result);
    expect(h.assert).not.toHaveBeenCalled();
  });

  it('returns to readyToSign on a cancelled passkey, submitting nothing (AC-18)', async () => {
    h.assert.mockResolvedValue({ status: 'cancelled' });
    const { result } = mount();
    await place(result);
    await sign(result);
    expect(result.current.state).toEqual({ status: 'readyToSign', data: prepareData });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('happy path: signs, submits with the prepared txXdr + extracted assertion, lands in submitted', async () => {
    const { result } = mount();
    await place(result);
    await sign(result);

    expect(h.submit).toHaveBeenCalledTimes(1);
    const [offeringArg, bodyArg, keyArg] = h.submit.mock.calls[0] ?? [];
    expect(offeringArg).toBe(OFFERING_ID);
    expect(bodyArg).toEqual({
      txXdr: prepareData.txXdr,
      credentialId: fakeAssertionResponse.id,
      authenticatorData: fakeAssertionResponse.response.authenticatorData,
      clientDataJSON: fakeAssertionResponse.response.clientDataJSON,
      signature: fakeAssertionResponse.response.signature,
    });
    // Same key as prepare (SEC-4).
    expect(keyArg).toBe(h.prepare.mock.calls[0]?.[2]);
    expect(result.current.state).toEqual({ status: 'submitted', bid: submittedBid });
  });

  it('on submit NETWORK_ERROR reconciles via getMyBid and never resubmits (AC-11)', async () => {
    h.submit.mockResolvedValue({ status: 'error', code: 'NETWORK_ERROR', message: 'offline' });
    h.refresh.mockResolvedValue({ status: 'success', bid: submittedBid });
    const { result } = mount();
    await place(result);
    await sign(result);

    expect(h.submit).toHaveBeenCalledTimes(1); // never a second submit
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'submitted', bid: submittedBid });
  });

  it('reconcile finding no bid lands in recheck (AC-11)', async () => {
    h.submit.mockResolvedValue({ status: 'error', code: 'NETWORK_ERROR', message: 'offline' });
    h.refresh.mockResolvedValue({ status: 'success', bid: null });
    const { result } = mount();
    await place(result);
    await sign(result);
    expect(result.current.state).toEqual({ status: 'recheck' });
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('IDEMPOTENCY_KEY_IN_FLIGHT reconciles while keeping the key (AC-16)', async () => {
    h.submit.mockResolvedValue({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      message: 'in flight',
    });
    h.refresh.mockResolvedValue({ status: 'success', bid: submittedBid });
    const { result } = mount();
    await place(result);
    await sign(result);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'submitted', bid: submittedBid });
  });

  it('IDEMPOTENCY_KEY_MISMATCH mints a fresh key and re-prepares (AC-16)', async () => {
    h.submit.mockResolvedValue({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_MISMATCH',
      message: 'mismatch',
    });
    const { result } = mount();
    await place(result);
    const firstKey = h.prepare.mock.calls[0]?.[2];
    await sign(result);
    expect(result.current.state).toMatchObject({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_MISMATCH',
      retry: 'reprepare',
    });

    // retry → idle, then a fresh placeBid uses a NEW key.
    act(() => result.current.retry());
    expect(result.current.state).toEqual({ status: 'idle' });
    h.submit.mockResolvedValue({ status: 'success', bid: submittedBid });
    await place(result);
    const secondKey = h.prepare.mock.calls[1]?.[2];
    expect(secondKey).not.toBe(firstKey);
  });

  it('BID_CHALLENGE_EXPIRED re-prepares with a fresh key (AC-15a)', async () => {
    h.submit.mockResolvedValue({
      status: 'error',
      code: 'BID_CHALLENGE_EXPIRED',
      message: 'expired',
    });
    const { result } = mount();
    await place(result);
    const firstKey = h.prepare.mock.calls[0]?.[2];
    await sign(result);
    expect(result.current.state).toMatchObject({
      status: 'error',
      code: 'BID_CHALLENGE_EXPIRED',
      retry: 'reprepare',
    });

    act(() => result.current.retry());
    await place(result);
    expect(h.prepare.mock.calls[1]?.[2]).not.toBe(firstKey);
  });

  it('OFFERING_WINDOW_CLOSED on submit → error with retry none, no re-prepare (AC-12)', async () => {
    h.submit.mockResolvedValue({
      status: 'error',
      code: 'OFFERING_WINDOW_CLOSED',
      message: 'closed',
    });
    const { result } = mount();
    await place(result);
    await sign(result);
    expect(result.current.state).toMatchObject({
      status: 'error',
      code: 'OFFERING_WINDOW_CLOSED',
      retry: 'none',
    });
  });

  it('SESSION_EXPIRED on prepare → sessionExpired (no redirect, AC-19)', async () => {
    h.prepare.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'x' });
    const { result } = mount();
    await place(result);
    expect(result.current.state).toEqual({ status: 'sessionExpired' });
  });

  it('SESSION_EXPIRED on submit → sessionExpired', async () => {
    h.submit.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'x' });
    const { result } = mount();
    await place(result);
    await sign(result);
    expect(result.current.state).toEqual({ status: 'sessionExpired' });
  });

  it('reconcile() from recheck adopts a now-visible bid', async () => {
    h.submit.mockResolvedValue({ status: 'error', code: 'NETWORK_ERROR', message: 'offline' });
    h.refresh.mockResolvedValue({ status: 'success', bid: null });
    const { result } = mount();
    await place(result);
    await sign(result);
    expect(result.current.state).toEqual({ status: 'recheck' });

    h.refresh.mockResolvedValue({ status: 'success', bid: submittedBid });
    await act(async () => {
      await result.current.reconcile();
    });
    expect(result.current.state).toEqual({ status: 'submitted', bid: submittedBid });
  });

  it('reset() returns to idle', async () => {
    const { result } = mount();
    await place(result);
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ status: 'idle' });
  });
});
