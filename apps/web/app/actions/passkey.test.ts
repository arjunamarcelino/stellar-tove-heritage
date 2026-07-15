import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fakeCreationOptions,
  fakeRegistrationResponse,
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

const finishInput = {
  email: 'a@b.com',
  attestationResponse: fakeRegistrationResponse,
};

describe('beginPasskeyRegistrationAction', () => {
  it('rejects an invalid email before calling the service', async () => {
    const result = await beginPasskeyRegistrationAction('not-an-email');
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
    expect(svc.begin).not.toHaveBeenCalled();
  });

  it('delegates with a normalized email and returns the service result', async () => {
    svc.begin.mockResolvedValue({ status: 'success', options: fakeCreationOptions });
    const result = await beginPasskeyRegistrationAction('  A@B.COM ');
    expect(svc.begin).toHaveBeenCalledWith('a@b.com');
    expect(result).toEqual({ status: 'success', options: fakeCreationOptions });
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
    const result = await finishPasskeyRegistrationAction({ ...finishInput, email: 'bad' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
    expect(svc.finish).not.toHaveBeenCalled();
  });

  it('rejects a malformed attestation shape before calling the service', async () => {
    const result = await finishPasskeyRegistrationAction({
      email: 'a@b.com',
      attestationResponse: { bogus: true } as never,
    });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
    expect(svc.finish).not.toHaveBeenCalled();
  });

  it('on success sets auth cookies and RETURNS the wallet address (never redirects)', async () => {
    svc.finish.mockResolvedValue({ status: 'success', ...fakeFinish201 });
    const result = await finishPasskeyRegistrationAction(finishInput);
    expect(setAuthTokenCookies).toHaveBeenCalledWith(
      cookieStore,
      fakeFinish201.accessToken,
      fakeFinish201.refreshToken,
    );
    expect(result).toEqual({ status: 'success', contractAddress: fakeContractAddress });
  });

  it('delegates with the normalized email and only the attestation', async () => {
    svc.finish.mockResolvedValue({ status: 'success', ...fakeFinish201 });
    await finishPasskeyRegistrationAction({ ...finishInput, email: '  A@B.COM ' });
    expect(svc.finish).toHaveBeenCalledWith({
      email: 'a@b.com',
      attestationResponse: fakeRegistrationResponse,
    });
  });

  it('does not set cookies on a service error', async () => {
    svc.finish.mockResolvedValue({ status: 'error', code: 'RATE_LIMITED', message: 'slow down' });
    const result = await finishPasskeyRegistrationAction(finishInput);
    expect(result).toMatchObject({ code: 'RATE_LIMITED' });
    expect(setAuthTokenCookies).not.toHaveBeenCalled();
  });
});
