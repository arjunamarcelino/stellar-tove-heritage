import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  fakeCreationOptions,
  fakeRegistrationResponse,
  fakeRequestOptions,
  fakeAssertionResponse,
  fakeFinish201,
  fakeContractAddress,
} from '@/test/fixtures/passkey';

const h = vi.hoisted(() => ({
  begin: vi.fn(),
  finish: vi.fn(),
  startPasskeyRegistration: vi.fn(),
  startPasskeyAssertion: vi.fn(),
}));

vi.mock('@/app/actions/passkey', () => ({
  beginPasskeyRegistrationAction: h.begin,
  finishPasskeyRegistrationAction: h.finish,
}));
vi.mock('@/lib/webauthn/passkey', () => ({
  startPasskeyRegistration: h.startPasskeyRegistration,
  startPasskeyAssertion: h.startPasskeyAssertion,
}));

import { usePasskeyEnroll } from '@/hooks/usePasskeyEnroll';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a signup ceremony.
  h.begin.mockResolvedValue({ status: 'success', mode: 'signup', options: fakeCreationOptions });
  h.startPasskeyRegistration.mockResolvedValue({
    status: 'success',
    response: fakeRegistrationResponse,
  });
  h.startPasskeyAssertion.mockResolvedValue({
    status: 'success',
    response: fakeAssertionResponse,
  });
  h.finish.mockResolvedValue({ status: 'success', ...fakeFinish201 });
});

describe('usePasskeyEnroll', () => {
  it('starts in idle', () => {
    const { result } = renderHook(() => usePasskeyEnroll());
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('walks the signup happy path to success carrying the wallet address', async () => {
    const { result } = renderHook(() => usePasskeyEnroll());
    await act(async () => {
      await result.current.enroll('a@b.com');
    });

    expect(result.current.state).toEqual({
      status: 'success',
      mode: 'signup',
      contractAddress: fakeContractAddress,
    });
    // order: begin → registration ceremony(options) → finish(email + attestation + mode)
    expect(h.begin).toHaveBeenCalledWith('a@b.com');
    expect(h.startPasskeyRegistration).toHaveBeenCalledWith(fakeCreationOptions);
    expect(h.startPasskeyAssertion).not.toHaveBeenCalled();
    expect(h.finish).toHaveBeenCalledWith({
      email: 'a@b.com',
      mode: 'signup',
      attestationResponse: fakeRegistrationResponse,
    });
  });

  it('walks the login happy path: runs the assertion ceremony and finishes with the assertion', async () => {
    h.begin.mockResolvedValue({ status: 'success', mode: 'login', options: fakeRequestOptions });
    const { result } = renderHook(() => usePasskeyEnroll());
    await act(async () => {
      await result.current.enroll('a@b.com');
    });

    expect(result.current.state).toEqual({
      status: 'success',
      mode: 'login',
      contractAddress: fakeContractAddress,
    });
    expect(h.startPasskeyAssertion).toHaveBeenCalledWith(fakeRequestOptions);
    expect(h.startPasskeyRegistration).not.toHaveBeenCalled();
    expect(h.finish).toHaveBeenCalledWith({
      email: 'a@b.com',
      mode: 'login',
      assertionResponse: fakeAssertionResponse,
    });
  });

  it('busyRef mutex: concurrent enroll() runs begin only once', async () => {
    let resolveBegin: (v: unknown) => void = () => {};
    h.begin.mockReturnValue(new Promise((r) => (resolveBegin = r)));
    const { result } = renderHook(() => usePasskeyEnroll());

    await act(async () => {
      void result.current.enroll('a@b.com');
      void result.current.enroll('a@b.com');
      resolveBegin({ status: 'error', code: 'RATE_LIMITED', message: 'x' });
    });

    expect(h.begin).toHaveBeenCalledTimes(1);
  });

  it('mutex releases after completion so a retry can run', async () => {
    h.begin.mockResolvedValue({ status: 'error', code: 'RATE_LIMITED', message: 'x' });
    const { result } = renderHook(() => usePasskeyEnroll());
    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    expect(h.begin).toHaveBeenCalledTimes(2);
  });

  it('begin error → error state; ceremony never runs', async () => {
    h.begin.mockResolvedValue({ status: 'error', code: 'EMAIL_CONFLICT', message: 'taken' });
    const { result } = renderHook(() => usePasskeyEnroll());
    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'EMAIL_CONFLICT' });
    expect(h.startPasskeyRegistration).not.toHaveBeenCalled();
  });

  it('ceremony cancelled → PASSKEY_CANCELLED; finish never runs', async () => {
    h.startPasskeyRegistration.mockResolvedValue({ status: 'cancelled' });
    const { result } = renderHook(() => usePasskeyEnroll());
    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'PASSKEY_CANCELLED' });
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('finish error → error state', async () => {
    h.finish.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'boom' });
    const { result } = renderHook(() => usePasskeyEnroll());
    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('retry() re-submits the SAME finish payload after WALLET_DEPLOY_FAILED (no new begin)', async () => {
    h.finish
      .mockResolvedValueOnce({ status: 'error', code: 'WALLET_DEPLOY_FAILED', message: 'boom' })
      .mockResolvedValueOnce({ status: 'success', ...fakeFinish201 });
    const { result } = renderHook(() => usePasskeyEnroll());

    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'WALLET_DEPLOY_FAILED' });

    await act(async () => {
      await result.current.retry('a@b.com');
    });

    expect(result.current.state).toEqual({
      status: 'success',
      mode: 'signup',
      contractAddress: fakeContractAddress,
    });
    // re-finish keeps the original challenge-bound email, ignoring the retry arg
    expect(h.finish).toHaveBeenNthCalledWith(2, {
      email: 'a@b.com',
      mode: 'signup',
      attestationResponse: fakeRegistrationResponse,
    });
    expect(h.begin).toHaveBeenCalledTimes(1); // did NOT re-begin
    expect(h.startPasskeyRegistration).toHaveBeenCalledTimes(1); // did NOT re-run the ceremony
    expect(h.finish).toHaveBeenCalledTimes(2); // same attestation re-submitted
  });

  it('retry() restarts from begin after a challenge-invalidating error', async () => {
    h.finish.mockResolvedValueOnce({
      status: 'error',
      code: 'AUTH_CHALLENGE_EXPIRED',
      message: 'expired',
    });
    const { result } = renderHook(() => usePasskeyEnroll());

    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    expect(result.current.state).toMatchObject({ status: 'error', code: 'AUTH_CHALLENGE_EXPIRED' });

    h.finish.mockResolvedValue({ status: 'success', ...fakeFinish201 });
    await act(async () => {
      await result.current.retry('corrected@b.com');
    });

    expect(h.begin).toHaveBeenCalledTimes(2); // restarted from begin
    expect(h.startPasskeyRegistration).toHaveBeenCalledTimes(2);
    // restart uses the live (corrected) email, not the stale one
    expect(h.begin).toHaveBeenNthCalledWith(2, 'corrected@b.com');
  });

  it('reset() returns to idle', async () => {
    h.begin.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'x' });
    const { result } = renderHook(() => usePasskeyEnroll());
    await act(async () => {
      await result.current.enroll('a@b.com');
    });
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ status: 'idle' });
  });
});
