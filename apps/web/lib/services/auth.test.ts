import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { registerUser, loginUser } from '@/lib/services/auth';

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

const registerPayload = {
  firstName: 'Leo',
  lastName: 'Davinci',
  email: 'leo@example.com',
  password: 'secret123',
};

describe('registerUser', () => {
  it('returns success on 201', async () => {
    stubFetch(201, {});
    expect(await registerUser(registerPayload)).toEqual({ status: 'success' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/v1/auth/register',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces backend message + fieldErrors on 400', async () => {
    stubFetch(400, { message: 'Invalid input', fieldErrors: { email: ['already taken'] } }, false);
    expect(await registerUser(registerPayload)).toEqual({
      status: 'error',
      message: 'Invalid input',
      fieldErrors: { email: 'already taken' },
    });
  });

  it('returns config error when API_BASE_URL is unset', async () => {
    delete process.env.API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await registerUser(registerPayload)).toMatchObject({ status: 'error' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a reach error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await registerUser(registerPayload)).toMatchObject({
      status: 'error',
      message: 'Unable to reach the authentication service',
    });
  });
});

describe('loginUser', () => {
  const loginPayload = { email: 'leo@example.com', password: 'secret123' };

  it('returns tokens on 200', async () => {
    stubFetch(200, { accessToken: 'a', refreshToken: 'r' });
    expect(await loginUser(loginPayload)).toEqual({
      status: 'success',
      accessToken: 'a',
      refreshToken: 'r',
    });
  });

  it('maps 401 to invalid credentials', async () => {
    stubFetch(401, {}, false);
    expect(await loginUser(loginPayload)).toEqual({
      status: 'error',
      message: 'Invalid email or password',
    });
  });

  it('maps 429 to too many attempts', async () => {
    stubFetch(429, {}, false);
    expect(await loginUser(loginPayload)).toMatchObject({
      status: 'error',
      message: 'Too many attempts. Please try again later.',
    });
  });

  it('returns a reach error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await loginUser(loginPayload)).toMatchObject({
      status: 'error',
      message: 'Unable to reach the authentication service',
    });
  });
});
