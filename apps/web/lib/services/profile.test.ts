import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getMyProfile,
  updateProfile,
  requestProfileImageUpload,
  commitProfileImage,
  getProfileImageStatus,
} from '@/lib/services/profile';

const OLD_ENV = process.env;

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

// A complete, valid GET /v1/me body.
function meBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'a@b.com',
    handle: 'maya',
    bio: 'hi',
    statement: null,
    socialLinks: { twitter: 'https://x.com/maya' },
    profileImage: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('getMyProfile', () => {
  it('GETs /v1/me no-store with a Bearer header and returns the parsed profile', async () => {
    const fetchFn = stubFetch(200, meBody());
    const result = await getMyProfile('tok');
    expect(result).toEqual({ status: 'success', profile: meBody() });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-store');
  });

  it('accepts all-null nullable fields', async () => {
    stubFetch(
      200,
      meBody({ email: null, handle: null, bio: null, statement: null, socialLinks: null }),
    );
    const result = await getMyProfile('tok');
    expect(result.status).toBe('success');
  });

  it('maps transport statuses to the right codes', async () => {
    stubFetch(401, {});
    expect(await getMyProfile('tok')).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(429, {});
    expect(await getMyProfile('tok')).toMatchObject({ code: 'RATE_LIMITED' });
    stubFetch(500, {});
    expect(await getMyProfile('tok')).toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('maps a schema-invalid body to SERVER_ERROR without leaking a raw message', async () => {
    stubFetch(200, { id: 'u1', message: 'internal detail' });
    const result = await getMyProfile('tok');
    expect(result).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    if (result.status === 'error') expect(result.message).not.toContain('internal detail');
  });

  it('maps a transport failure (status 0) to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getMyProfile('tok')).toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('updateProfile', () => {
  it('PATCHes /v1/me with the patch body + Bearer header and returns the updated profile', async () => {
    const fetchFn = stubFetch(200, meBody({ bio: 'updated' }));
    const result = await updateProfile('tok', { bio: 'updated' });
    expect(result).toEqual({ status: 'success', profile: meBody({ bio: 'updated' }) });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me');
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ bio: 'updated' });
  });

  it('maps a 422 VALIDATION_FAILED with errors[] into fieldPaths only (drops raw messages)', async () => {
    stubFetch(422, {
      errorCode: 'VALIDATION_FAILED',
      message: 'invalid',
      errors: [
        { field: 'bio', message: 'RAW too long' },
        { field: 'socialLinks.twitter', message: 'RAW bad handle' },
      ],
    });
    const result = await updateProfile('tok', { bio: 'x' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    if (result.status === 'error') {
      expect(result.fieldPaths).toEqual(['bio', 'socialLinks.twitter']);
      // Only paths cross the boundary — no raw backend message strings anywhere in the result.
      expect(JSON.stringify(result)).not.toContain('RAW');
      expect(result.message).not.toContain('invalid');
    }
  });

  it('maps a 422 VALIDATION_FAILED with no errors[] to the code without fieldPaths', async () => {
    stubFetch(422, { errorCode: 'VALIDATION_FAILED' });
    const result = await updateProfile('tok', { bio: 'x' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    if (result.status === 'error') expect(result.fieldPaths).toBeUndefined();
  });

  it('maps a default NestJS 400 (no errorCode) to VALIDATION_FAILED, not SERVER_ERROR (#222)', async () => {
    stubFetch(400, { message: ['bio must be shorter than 300 characters'], error: 'Bad Request' });
    const result = await updateProfile('tok', { bio: 'x' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    // No structured errors[] → no per-field map (the raw message[] is never surfaced).
    if (result.status === 'error') expect(result.fieldPaths).toBeUndefined();
  });

  it('passes through PROFILE_IMAGE_NOT_READY (422) and PROFILE_IMAGE_NOT_FOUND (404)', async () => {
    stubFetch(422, { errorCode: 'PROFILE_IMAGE_NOT_READY' });
    expect(await updateProfile('tok', {})).toMatchObject({ code: 'PROFILE_IMAGE_NOT_READY' });
    stubFetch(404, { errorCode: 'PROFILE_IMAGE_NOT_FOUND' });
    expect(await updateProfile('tok', {})).toMatchObject({ code: 'PROFILE_IMAGE_NOT_FOUND' });
  });

  it('falls back by status when no usable backend code is present', async () => {
    stubFetch(429, {});
    expect(await updateProfile('tok', {})).toMatchObject({ code: 'RATE_LIMITED' });
    stubFetch(401, {});
    expect(await updateProfile('tok', {})).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(500, {});
    expect(await updateProfile('tok', {})).toMatchObject({ code: 'SERVER_ERROR' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await updateProfile('tok', {})).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('maps a schema-invalid 200 body to SERVER_ERROR without leaking a raw message', async () => {
    stubFetch(200, { id: 'u1', message: 'internal detail' });
    const result = await updateProfile('tok', {});
    expect(result).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    if (result.status === 'error') expect(result.message).not.toContain('internal detail');
  });
});

describe('requestProfileImageUpload', () => {
  it('POSTs an empty body with Bearer + Idempotency-Key and returns the upload target', async () => {
    const fetchFn = stubFetch(200, {
      profileImageId: 'img1',
      upload: { method: 'PUT', url: 'https://storage.test/put?token=abc', headers: { 'x-h': '1' } },
    });
    const result = await requestProfileImageUpload('tok', 'key-1');
    expect(result).toEqual({
      status: 'success',
      profileImageId: 'img1',
      upload: { method: 'PUT', url: 'https://storage.test/put?token=abc', headers: { 'x-h': '1' } },
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/profile-image');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Idempotency-Key']).toBe('key-1');
    expect(JSON.parse(init.body)).toEqual({});
  });

  it('maps transport statuses (401/429/0) and schema drift', async () => {
    stubFetch(401, {});
    expect(await requestProfileImageUpload('tok', 'k')).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(429, {});
    expect(await requestProfileImageUpload('tok', 'k')).toMatchObject({ code: 'RATE_LIMITED' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await requestProfileImageUpload('tok', 'k')).toMatchObject({ code: 'NETWORK_ERROR' });
    stubFetch(200, { profileImageId: 'img1' });
    const drift = await requestProfileImageUpload('tok', 'k');
    expect(drift).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });
});

describe('commitProfileImage', () => {
  it('POSTs the profileImageId with Bearer + Idempotency-Key and returns imageStatus', async () => {
    const fetchFn = stubFetch(200, { profileImageId: 'img1', status: 'processing' });
    const result = await commitProfileImage('tok', 'img1', 'key-2');
    expect(result).toEqual({
      status: 'success',
      profileImageId: 'img1',
      imageStatus: 'processing',
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/profile-image/commit');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Idempotency-Key']).toBe('key-2');
    expect(JSON.parse(init.body)).toEqual({ profileImageId: 'img1' });
  });

  it('absorbs a 409 ALREADY_COMMITTED into the success arm (idempotent replay)', async () => {
    stubFetch(409, { errorCode: 'PROFILE_IMAGE_ALREADY_COMMITTED' });
    const result = await commitProfileImage('tok', 'img1', 'key-2');
    expect(result).toEqual({
      status: 'success',
      profileImageId: 'img1',
      imageStatus: 'processing',
    });
  });

  it('passes through each commit backend code', async () => {
    const cases: Array<[number, string]> = [
      [404, 'PROFILE_IMAGE_NOT_FOUND'],
      [410, 'PROFILE_UPLOAD_EXPIRED'],
      [422, 'PROFILE_UPLOAD_NOT_FOUND'],
      [422, 'PROFILE_IMAGE_TOO_LARGE'],
      [422, 'PROFILE_IMAGE_INVALID'],
    ];
    for (const [status, code] of cases) {
      stubFetch(status, { errorCode: code });
      expect(await commitProfileImage('tok', 'img1', 'k')).toMatchObject({ status: 'error', code });
    }
  });

  it('falls back by status when no usable backend code is present', async () => {
    stubFetch(429, {});
    expect(await commitProfileImage('tok', 'img1', 'k')).toMatchObject({ code: 'RATE_LIMITED' });
    stubFetch(401, {});
    expect(await commitProfileImage('tok', 'img1', 'k')).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(500, {});
    expect(await commitProfileImage('tok', 'img1', 'k')).toMatchObject({ code: 'SERVER_ERROR' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await commitProfileImage('tok', 'img1', 'k')).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('maps a schema-invalid 200 body to SERVER_ERROR without leaking a raw message', async () => {
    stubFetch(200, { profileImageId: 'img1', status: 'bogus', message: 'internal detail' });
    const result = await commitProfileImage('tok', 'img1', 'k');
    expect(result).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    if (result.status === 'error') expect(result.message).not.toContain('internal detail');
  });
});

describe('getProfileImageStatus', () => {
  it('GETs the id no-store with a Bearer header and normalizes id → profileImageId', async () => {
    const fetchFn = stubFetch(200, { id: 'img1', status: 'ready' });
    const result = await getProfileImageStatus('tok', 'img1');
    expect(result).toEqual({ status: 'success', profileImageId: 'img1', imageStatus: 'ready' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/profile-image/img1');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-store');
  });

  it('maps transport statuses and schema drift', async () => {
    stubFetch(401, {});
    expect(await getProfileImageStatus('tok', 'img1')).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(429, {});
    expect(await getProfileImageStatus('tok', 'img1')).toMatchObject({ code: 'RATE_LIMITED' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getProfileImageStatus('tok', 'img1')).toMatchObject({ code: 'NETWORK_ERROR' });
    stubFetch(200, { id: 'img1', status: 'bogus' });
    expect(await getProfileImageStatus('tok', 'img1')).toMatchObject({ code: 'SERVER_ERROR' });
  });
});
