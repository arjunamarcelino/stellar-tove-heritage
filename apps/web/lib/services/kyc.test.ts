import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getKycStatus, submitKyc, getWhitelistStatus } from '@/lib/services/kyc';
import { WHITELIST_REASON_FALLBACK } from '@/lib/kyc/whitelistMessages';

const OLD_ENV = process.env;
const KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

function sampleForm(): FormData {
  const fd = new FormData();
  fd.set('claimedJurisdiction', 'GB');
  fd.set('gov_id_front', new File(['x'], 'front.jpg', { type: 'image/jpeg' }));
  fd.set('gov_id_back', new File(['x'], 'back.jpg', { type: 'image/jpeg' }));
  fd.set('proof_of_address', new File(['x'], 'poa.pdf', { type: 'application/pdf' }));
  fd.set('selfie', new File(['x'], 'selfie.png', { type: 'image/png' }));
  return fd;
}

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('getKycStatus', () => {
  it('GETs /v1/me/kyc with a Bearer header and returns the parsed status', async () => {
    const fetchFn = stubFetch(200, { kycStatus: 'not_submitted', latestSubmission: null });
    const result = await getKycStatus('tok');
    expect(result).toEqual({
      status: 'success',
      kycStatus: 'not_submitted',
      latestSubmission: null,
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/kyc');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('parses a latest submission and tolerates a missing latestSubmission (forward-compat)', async () => {
    stubFetch(200, {
      kycStatus: 'pending_review',
      latestSubmission: {
        submissionId: 's1',
        status: 'pending_review',
        claimedJurisdiction: 'GB',
        createdAt: '2026-07-17T00:00:00Z',
      },
    });
    expect(await getKycStatus('tok')).toMatchObject({
      status: 'success',
      kycStatus: 'pending_review',
      latestSubmission: { submissionId: 's1', claimedJurisdiction: 'GB' },
    });

    stubFetch(200, { kycStatus: 'approved' }); // latestSubmission omitted entirely
    expect(await getKycStatus('tok')).toEqual({
      status: 'success',
      kycStatus: 'approved',
      latestSubmission: null,
    });
  });

  it('maps 401 to SESSION_EXPIRED and a malformed body to SERVER_ERROR', async () => {
    stubFetch(401, {});
    expect(await getKycStatus('tok')).toMatchObject({ status: 'error', code: 'SESSION_EXPIRED' });
    stubFetch(200, { kycStatus: 'bogus' });
    expect(await getKycStatus('tok')).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
  });

  it('returns NETWORK_ERROR when API_BASE_URL is unset (no fetch)', async () => {
    delete process.env.API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getKycStatus('tok')).toMatchObject({ status: 'error', code: 'NETWORK_ERROR' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('submitKyc', () => {
  it('POSTs multipart to /v1/me/kyc/submissions with auth + Idempotency-Key and no Content-Type', async () => {
    const fetchFn = stubFetch(202, { submissionId: 's1', kycStatus: 'pending_review' });
    const result = await submitKyc('tok', sampleForm(), KEY);
    expect(result).toEqual({
      status: 'success',
      submissionId: 's1',
      kycStatus: 'pending_review',
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/kyc/submissions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Idempotency-Key']).toBe(KEY);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('passes through backend errorCodes (422 JURISDICTION_NOT_ELIGIBLE, 409 KYC_ALREADY_PENDING)', async () => {
    stubFetch(422, { errorCode: 'JURISDICTION_NOT_ELIGIBLE' });
    expect(await submitKyc('tok', sampleForm(), KEY)).toMatchObject({
      status: 'error',
      code: 'JURISDICTION_NOT_ELIGIBLE',
    });
    stubFetch(409, { errorCode: 'KYC_ALREADY_PENDING' });
    expect(await submitKyc('tok', sampleForm(), KEY)).toMatchObject({
      status: 'error',
      code: 'KYC_ALREADY_PENDING',
    });
  });

  it('falls back by status when no errorCode: 429 → RATE_LIMITED, transport failure → NETWORK_ERROR', async () => {
    stubFetch(429, {});
    expect(await submitKyc('tok', sampleForm(), KEY)).toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await submitKyc('tok', sampleForm(), KEY)).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });

  it('returns SERVER_ERROR on a malformed 202 body', async () => {
    stubFetch(202, { nope: true });
    expect(await submitKyc('tok', sampleForm(), KEY)).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });
});

describe('getWhitelistStatus', () => {
  // Wire shape (locked with TOV-29): camelCase, all four keys always present, null when N/A.
  const body = (over: Record<string, unknown>) => ({
    status: 'not_submitted',
    whitelistedAt: null,
    reason: null,
    lastSubmissionAt: null,
    ...over,
  });

  it('GETs /v1/me/kyc/status with a Bearer header', async () => {
    const fetchFn = stubFetch(200, body({ status: 'not_submitted' }));
    const result = await getWhitelistStatus('tok');
    expect(result).toEqual({ status: 'success', data: { status: 'not_submitted' } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/kyc/status');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('narrows pending_review to lastSubmissionAt, tolerating null', async () => {
    stubFetch(200, body({ status: 'pending_review', lastSubmissionAt: '2026-07-17T00:00:00Z' }));
    expect(await getWhitelistStatus('tok')).toEqual({
      status: 'success',
      data: { status: 'pending_review', lastSubmissionAt: '2026-07-17T00:00:00Z' },
    });

    stubFetch(200, body({ status: 'pending_review', lastSubmissionAt: null }));
    expect(await getWhitelistStatus('tok')).toEqual({
      status: 'success',
      data: { status: 'pending_review', lastSubmissionAt: null },
    });
  });

  it('narrows whitelisted (whitelistedAt); resolves frozen/removed reason to curated copy server-side', async () => {
    stubFetch(200, body({ status: 'whitelisted', whitelistedAt: '2026-07-17T00:00:00Z' }));
    expect(await getWhitelistStatus('tok')).toEqual({
      status: 'success',
      data: { status: 'whitelisted', whitelistedAt: '2026-07-17T00:00:00Z' },
    });

    // Phase 0 ships reason: null → resolves to the generic fallback copy (map empty until M12).
    stubFetch(200, body({ status: 'frozen', reason: null }));
    expect(await getWhitelistStatus('tok')).toEqual({
      status: 'success',
      data: { status: 'frozen', reasonCopy: WHITELIST_REASON_FALLBACK.frozen },
    });

    stubFetch(200, body({ status: 'removed', reason: null }));
    expect(await getWhitelistStatus('tok')).toEqual({
      status: 'success',
      data: { status: 'removed', reasonCopy: WHITELIST_REASON_FALLBACK.removed },
    });
  });

  it('resolves an opaque reason code to curated copy and never egresses the raw code', async () => {
    stubFetch(200, body({ status: 'frozen', reason: 'sanctions_hit_internal_note' }));
    const result = await getWhitelistStatus('tok');
    // Curated copy only; the raw backend code must not appear anywhere in the client-bound payload.
    expect(result).toEqual({
      status: 'success',
      data: { status: 'frozen', reasonCopy: WHITELIST_REASON_FALLBACK.frozen },
    });
    expect(JSON.stringify(result)).not.toContain('sanctions_hit_internal_note');
  });

  it('rejects a malformed body missing a required key as SERVER_ERROR', async () => {
    stubFetch(200, { status: 'whitelisted' }); // missing the always-present keys
    expect(await getWhitelistStatus('tok')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('rejects an unknown status enum value as SERVER_ERROR', async () => {
    stubFetch(200, body({ status: 'suspended' }));
    expect(await getWhitelistStatus('tok')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('maps 401 → SESSION_EXPIRED and transport failure → NETWORK_ERROR', async () => {
    stubFetch(401, {});
    expect(await getWhitelistStatus('tok')).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await getWhitelistStatus('tok')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });
});
