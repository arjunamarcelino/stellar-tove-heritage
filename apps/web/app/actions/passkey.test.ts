import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fakeCreationOptions,
  fakeRegistrationResponse,
  fakeAssertionResponse,
  fakeFinish201,
  fakeContractAddress,
} from '@/test/fixtures/passkey';

const h = vi.hoisted(() => ({
  begin: vi.fn(),
  finish: vi.fn(),
  cookieStore: { set: vi.fn() },
  setAuthTokenCookies: vi.fn(),
}));
const svc = h;
const cookieStore = h.cookieStore;
const setAuthTokenCookies = h.setAuthTokenCookies;

vi.mock('@/lib/services/passkey', () => ({ begin: h.begin, finish: h.finish }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));
vi.mock('@/lib/cookies', () => ({ setAuthTokenCookies: h.setAuthTokenCookies }));

import {
  beginPasskeyRegistrationAction,
  finishPasskeyRegistrationAction,
} from '@/app/actions/passkey';

beforeEach(() => vi.clearAllMocks());

const signupFinishInput = {
  email: 'a@b.com',
  mode: 'signup' as const,
  attestationResponse: fakeRegistrationResponse,
};
const loginFinishInput = {
  email: 'a@b.com',
  mode: 'login' as const,
  assertionResponse: fakeAssertionResponse,
};

describe('beginPasskeyRegistrationAction', () => {
  it('rejects an invalid email before calling the service', async () => {
    const result = await beginPasskeyRegistrationAction('not-an-email');
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
    expect(svc.begin).not.toHaveBeenCalled();
  });

  it('delegates with a normalized email and returns the service result (with mode)', async () => {
    svc.begin.mockResolvedValue({ status: 'success', mode: 'signup', options: fakeCreationOptions });
    const result = await beginPasskeyRegistrationAction('  A@B.COM ');
    expect(svc.begin).toHaveBeenCalledWith('a@b.com');
    expect(result).toEqual({ status: 'success', mode: 'signup', options: fakeCreationOptions });
  });

  it('passes a service error through without setting cookies', async () => {
    svc.begin.mockResolvedValue({ status: 'error', code: 'EMAIL_CONFLICT', message: 'taken' });
    const result = await beginPasskeyRegistrationAction('a@b.com');
    expect(result).toMatchObject({ code: 'EMAIL_CONFLICT' });
    expect(setAuthTokenCookies).not.toHaveBeenCalled();
  });
});

describe('finishPasskeyRegistrationAction', () => {
  it('rejects an invalid email before calling the service', async () => {
    const result = await finishPasskeyRegistrationAction({ ...signupFinishInput, email: 'bad' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
    expect(svc.finish).not.toHaveBeenCalled();
  });

  it('rejects a malformed attestation shape (signup) before calling the service', async () => {
    const result = await finishPasskeyRegistrationAction({
      email: 'a@b.com',
      mode: 'signup',
      attestationResponse: { bogus: true } as never,
    });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
    expect(svc.finish).not.toHaveBeenCalled();
  });

  it('rejects a malformed assertion shape (login) before calling the service', async () => {
    const result = await finishPasskeyRegistrationAction({
      email: 'a@b.com',
      mode: 'login',
      assertionResponse: { bogus: true } as never,
    });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
    expect(svc.finish).not.toHaveBeenCalled();
  });

  it('on success sets auth cookies and RETURNS the wallet address (never redirects)', async () => {
    svc.finish.mockResolvedValue({ status: 'success', ...fakeFinish201 });
    const result = await finishPasskeyRegistrationAction(signupFinishInput);
    expect(setAuthTokenCookies).toHaveBeenCalledWith(
      cookieStore,
      fakeFinish201.accessToken,
      fakeFinish201.refreshToken,
    );
    expect(result).toEqual({ status: 'success', contractAddress: fakeContractAddress });
  });

  it('signup delegates with the normalized email and the attestation + mode', async () => {
    svc.finish.mockResolvedValue({ status: 'success', ...fakeFinish201 });
    await finishPasskeyRegistrationAction({ ...signupFinishInput, email: '  A@B.COM ' });
    expect(svc.finish).toHaveBeenCalledWith({
      email: 'a@b.com',
      mode: 'signup',
      attestationResponse: fakeRegistrationResponse,
    });
  });

  it('login delegates with the normalized email and the assertion + mode', async () => {
    svc.finish.mockResolvedValue({ status: 'success', ...fakeFinish201 });
    await finishPasskeyRegistrationAction({ ...loginFinishInput, email: '  A@B.COM ' });
    expect(svc.finish).toHaveBeenCalledWith({
      email: 'a@b.com',
      mode: 'login',
      assertionResponse: fakeAssertionResponse,
    });
  });

  it('does not set cookies on a service error', async () => {
    svc.finish.mockResolvedValue({ status: 'error', code: 'RATE_LIMITED', message: 'slow down' });
    const result = await finishPasskeyRegistrationAction(signupFinishInput);
    expect(result).toMatchObject({ code: 'RATE_LIMITED' });
    expect(setAuthTokenCookies).not.toHaveBeenCalled();
  });
});
