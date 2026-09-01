import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fakeCreationOptions,
  fakeRegistrationResponse,
  fakeRequestOptions,
  fakeAssertionResponse,
  fakeFinish201,
} from '@/test/fixtures/passkey';

vi.mock('server-only', () => ({}));

import { begin, finish } from '@/lib/services/passkey';

const OLD_ENV = process.env;

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) }),
  );
}

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

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

describe('begin', () => {
  it('returns NETWORK_ERROR when API_BASE_URL is unset (no fetch)', async () => {
    delete process.env.API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await begin('a@b.com');
    expect(result).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to /passkey/begin and returns signup mode + creation options on 200', async () => {
    stubFetch(200, { mode: 'signup', options: fakeCreationOptions });
    const result = await begin('a@b.com');
    expect(result).toEqual({ status: 'success', mode: 'signup', options: fakeCreationOptions });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/v1/auth/passkey/begin',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns login mode + request options on 200', async () => {
    stubFetch(200, { mode: 'login', options: fakeRequestOptions });
    const result = await begin('a@b.com');
    expect(result).toEqual({ status: 'success', mode: 'login', options: fakeRequestOptions });
  });

  it('accepts top-level options alongside mode (no options envelope)', async () => {
    stubFetch(200, { mode: 'signup', ...fakeCreationOptions });
    const result = await begin('a@b.com');
    expect(result).toMatchObject({ status: 'success', mode: 'signup' });
  });

  it('returns SERVER_ERROR when mode is missing', async () => {
    stubFetch(200, { options: fakeCreationOptions });
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('maps 409 (no code) to EMAIL_CONFLICT and surfaces the backend message', async () => {
    stubFetch(409, { message: 'Email already registered' }, false);
    const result = await begin('a@b.com');
    expect(result).toMatchObject({
      status: 'error',
      code: 'EMAIL_CONFLICT',
      message: 'Email already registered',
    });
  });

  it('maps 429 to RATE_LIMITED', async () => {
    stubFetch(429, {}, false);
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'RATE_LIMITED' });
  });

  it('maps the backend errorCode field (AUTH_EMAIL_CONFLICT) over HTTP status', async () => {
    stubFetch(409, { errorCode: 'AUTH_EMAIL_CONFLICT', message: 'taken' }, false);
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'EMAIL_CONFLICT' });
  });

  it('maps 400 VALIDATION_FAILED to VALIDATION_ERROR', async () => {
    stubFetch(400, { errorCode: 'VALIDATION_FAILED', message: 'bad email' }, false);
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'VALIDATION_ERROR' });
  });

  it('returns SERVER_ERROR on 200 with unusable options', async () => {
    stubFetch(200, { mode: 'signup', nope: true });
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('returns NETWORK_ERROR when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
  });
});

describe('finish', () => {
  it('returns { accessToken, refreshToken, contractAddress } on 200 (signup)', async () => {
    stubFetch(200, fakeFinish201);
    const result = await finish(signupFinishInput);
    expect(result).toEqual({ status: 'success', ...fakeFinish201 });
  });

  it('signup sends only { email, attestationResponse } (no mode, no deviceName)', async () => {
    stubFetch(200, fakeFinish201);
    await finish(signupFinishInput);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/v1/auth/passkey/finish');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ email: 'a@b.com', attestationResponse: fakeRegistrationResponse });
  });

  it('login sends only { email, assertionResponse }', async () => {
    stubFetch(200, fakeFinish201);
    await finish(loginFinishInput);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ email: 'a@b.com', assertionResponse: fakeAssertionResponse });
  });

  it('returns SERVER_ERROR when the body is missing tokens', async () => {
    stubFetch(200, { accessToken: 'a' });
    expect(await finish(signupFinishInput)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('returns SERVER_ERROR when the body is missing contractAddress', async () => {
    stubFetch(200, { accessToken: 'a', refreshToken: 'r' });
    expect(await finish(signupFinishInput)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('maps 409 (no code) to PASSKEY_ALREADY_BOUND on finish', async () => {
    stubFetch(409, {}, false);
    expect(await finish(signupFinishInput)).toMatchObject({
      status: 'error',
      code: 'PASSKEY_ALREADY_BOUND',
    });
  });

  it('maps 401 AUTH_CHALLENGE_EXPIRED (errorCode) to AUTH_CHALLENGE_EXPIRED', async () => {
    stubFetch(401, { errorCode: 'AUTH_CHALLENGE_EXPIRED', message: 'expired' }, false);
    expect(await finish(loginFinishInput)).toMatchObject({
      status: 'error',
      code: 'AUTH_CHALLENGE_EXPIRED',
    });
  });

  it('maps 401 AUTH_CHALLENGE_NOT_FOUND to AUTH_CHALLENGE_EXPIRED', async () => {
    stubFetch(401, { errorCode: 'AUTH_CHALLENGE_NOT_FOUND' }, false);
    expect(await finish(loginFinishInput)).toMatchObject({
      status: 'error',
      code: 'AUTH_CHALLENGE_EXPIRED',
    });
  });

  it('maps 401 AUTH_PASSKEY_VERIFICATION_FAILED to PASSKEY_VERIFICATION_FAILED', async () => {
    stubFetch(401, { errorCode: 'AUTH_PASSKEY_VERIFICATION_FAILED' }, false);
    expect(await finish(signupFinishInput)).toMatchObject({
      status: 'error',
      code: 'PASSKEY_VERIFICATION_FAILED',
    });
  });

  it('maps 503 WALLET_DEPLOY_FAILED to WALLET_DEPLOY_FAILED (retryable)', async () => {
    stubFetch(503, { errorCode: 'WALLET_DEPLOY_FAILED' }, false);
    expect(await finish(signupFinishInput)).toMatchObject({
      status: 'error',
      code: 'WALLET_DEPLOY_FAILED',
    });
  });
});
