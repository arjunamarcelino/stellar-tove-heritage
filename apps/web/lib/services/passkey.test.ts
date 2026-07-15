import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fakeCreationOptions,
  fakeRegistrationResponse,
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

const finishInput = {
  email: 'a@b.com',
  attestationResponse: fakeRegistrationResponse,
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

  it('POSTs to /register/begin and returns wrapped options on 200', async () => {
    stubFetch(200, { options: fakeCreationOptions });
    const result = await begin('a@b.com');
    expect(result).toEqual({ status: 'success', options: fakeCreationOptions });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/v1/auth/passkey/register/begin',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('accepts bare options (no envelope) on 200', async () => {
    stubFetch(200, fakeCreationOptions);
    const result = await begin('a@b.com');
    expect(result).toMatchObject({ status: 'success' });
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
    stubFetch(200, { nope: true });
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('returns NETWORK_ERROR when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await begin('a@b.com')).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
  });
});

describe('finish', () => {
  it('returns { accessToken, refreshToken, contractAddress } on 201', async () => {
    stubFetch(201, fakeFinish201);
    const result = await finish(finishInput);
    expect(result).toEqual({ status: 'success', ...fakeFinish201 });
  });

  it('sends only { email, attestationResponse } (no deviceName)', async () => {
    stubFetch(201, fakeFinish201);
    await finish(finishInput);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ email: 'a@b.com', attestationResponse: fakeRegistrationResponse });
  });

  it('returns SERVER_ERROR when the 201 body is missing tokens', async () => {
    stubFetch(201, { accessToken: 'a' });
    expect(await finish(finishInput)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('returns SERVER_ERROR when the 201 body is missing contractAddress', async () => {
    stubFetch(201, { accessToken: 'a', refreshToken: 'r' });
    expect(await finish(finishInput)).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('maps 409 (no code) to PASSKEY_ALREADY_BOUND on finish', async () => {
    stubFetch(409, {}, false);
    expect(await finish(finishInput)).toMatchObject({
      status: 'error',
      code: 'PASSKEY_ALREADY_BOUND',
    });
  });

  it('maps 401 AUTH_CHALLENGE_EXPIRED (errorCode) to AUTH_CHALLENGE_EXPIRED', async () => {
    stubFetch(401, { errorCode: 'AUTH_CHALLENGE_EXPIRED', message: 'expired' }, false);
    expect(await finish(finishInput)).toMatchObject({
      status: 'error',
      code: 'AUTH_CHALLENGE_EXPIRED',
    });
  });

  it('maps 401 AUTH_PASSKEY_VERIFICATION_FAILED to PASSKEY_VERIFICATION_FAILED', async () => {
    stubFetch(401, { errorCode: 'AUTH_PASSKEY_VERIFICATION_FAILED' }, false);
    expect(await finish(finishInput)).toMatchObject({
      status: 'error',
      code: 'PASSKEY_VERIFICATION_FAILED',
    });
  });

  it('maps 503 WALLET_DEPLOY_FAILED to WALLET_DEPLOY_FAILED (retryable)', async () => {
    stubFetch(503, { errorCode: 'WALLET_DEPLOY_FAILED' }, false);
    expect(await finish(finishInput)).toMatchObject({
      status: 'error',
      code: 'WALLET_DEPLOY_FAILED',
    });
  });
});
