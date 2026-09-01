import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getBeneficiary, setBeneficiary, removeBeneficiary } from '@/lib/services/beneficiary';
import type { BeneficiaryWriteBody } from '@/lib/beneficiary/schemas';

const OLD_ENV = process.env;

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

// A 204/empty body: res.json() throws → the service treats data as null (deleteJson contract).
function stubEmptyFetch(status: number, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockRejectedValue(new Error('Unexpected end of JSON input')),
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

// A complete, valid beneficiary row.
function beneficiaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    stellarPubkey: 'GABCDEF',
    relationship: 'Spouse',
    notes: 'Primary heir',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const WRITE_BODY: BeneficiaryWriteBody = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: null,
  relationship: null,
  notes: null,
};

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('getBeneficiary', () => {
  it('GETs /v1/me/beneficiary no-store with a Bearer header and returns row + narrowed notice', async () => {
    const fetchFn = stubFetch(200, {
      beneficiary: beneficiaryRow(),
      notice: { code: 'KYC_REQUIRED_FOR_TRANSFER', message: 'raw backend copy' },
    });
    const result = await getBeneficiary('tok');
    expect(result).toEqual({
      status: 'success',
      beneficiary: beneficiaryRow(),
      notice: { code: 'KYC_REQUIRED_FOR_TRANSFER' },
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/beneficiary');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-store');
    // The notice is narrowed to { code } only — the backend message never egresses.
    if (result.status === 'success') {
      expect(result.notice).not.toHaveProperty('message');
      expect(JSON.stringify(result)).not.toContain('raw backend copy');
    }
  });

  it('narrows a KYC notice to { code } and drops the backend message on a null-beneficiary read', async () => {
    const result = await (async () => {
      stubFetch(200, {
        beneficiary: null,
        notice: { code: 'KYC_REQUIRED_FOR_TRANSFER', message: 'x' },
      });
      return getBeneficiary('tok');
    })();
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.beneficiary).toBeNull();
      expect(result.notice).toEqual({ code: 'KYC_REQUIRED_FOR_TRANSFER' });
      expect(result.notice).not.toHaveProperty('message');
    }
  });

  it('keeps notice null when the backend sends notice:null (whitelisted collector)', async () => {
    stubFetch(200, { beneficiary: beneficiaryRow(), notice: null });
    const result = await getBeneficiary('tok');
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.notice).toBeNull();
  });

  it('degrades an unknown notice code to null (lenient) rather than failing the read', async () => {
    stubFetch(200, {
      beneficiary: beneficiaryRow(),
      notice: { code: 'SOME_FUTURE_CODE', message: 'ignore me' },
    });
    const result = await getBeneficiary('tok');
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.notice).toBeNull();
  });

  it('maps transport statuses to the right codes (no VALIDATION_FAILED on a GET)', async () => {
    stubFetch(401, {});
    expect(await getBeneficiary('tok')).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(429, {});
    expect(await getBeneficiary('tok')).toMatchObject({ code: 'RATE_LIMITED' });
    stubFetch(500, {});
    expect(await getBeneficiary('tok')).toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('maps a transport failure (status 0) to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await getBeneficiary('tok')).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('maps a schema-invalid body to SERVER_ERROR without leaking a raw message', async () => {
    stubFetch(200, { beneficiary: { id: 'b1' }, message: 'internal detail' });
    const result = await getBeneficiary('tok');
    expect(result).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    if (result.status === 'error') expect(result.message).not.toContain('internal detail');
  });
});

describe('setBeneficiary', () => {
  it('POSTs all five keys with a Bearer header (nulls preserved, no extra keys)', async () => {
    const fetchFn = stubFetch(200, { beneficiary: beneficiaryRow(), notice: null });
    const result = await setBeneficiary('tok', WRITE_BODY);
    expect(result).toEqual({ status: 'success', beneficiary: beneficiaryRow(), notice: null });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/beneficiary');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      stellarPubkey: null,
      relationship: null,
      notes: null,
    });
    // Full-replace wire contract: exactly the five whitelisted keys, no extras.
    expect(Object.keys(sent).sort()).toEqual(
      ['email', 'name', 'notes', 'relationship', 'stellarPubkey'].sort(),
    );
  });

  it('returns the saved row (with notice narrowed) on a 200', async () => {
    stubFetch(200, {
      beneficiary: beneficiaryRow({ relationship: 'Sibling' }),
      notice: { code: 'KYC_REQUIRED_FOR_TRANSFER', message: 'x' },
    });
    const result = await setBeneficiary('tok', WRITE_BODY);
    expect(result).toEqual({
      status: 'success',
      beneficiary: beneficiaryRow({ relationship: 'Sibling' }),
      notice: { code: 'KYC_REQUIRED_FOR_TRANSFER' },
    });
  });

  it('maps a 400 to VALIDATION_FAILED with curated copy (never the raw backend message[])', async () => {
    stubFetch(400, { message: ['email must be an email'], error: 'Bad Request' });
    const result = await setBeneficiary('tok', WRITE_BODY);
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    if (result.status === 'error') {
      expect(result.message).not.toContain('must be an email');
      expect(JSON.stringify(result)).not.toContain('must be an email');
    }
  });

  it('maps transport statuses (401/429/0) and schema drift', async () => {
    stubFetch(401, {});
    expect(await setBeneficiary('tok', WRITE_BODY)).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(429, {});
    expect(await setBeneficiary('tok', WRITE_BODY)).toMatchObject({ code: 'RATE_LIMITED' });
    stubFetch(500, {});
    expect(await setBeneficiary('tok', WRITE_BODY)).toMatchObject({ code: 'SERVER_ERROR' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await setBeneficiary('tok', WRITE_BODY)).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('maps a schema-invalid 200 body to SERVER_ERROR without leaking a raw message', async () => {
    stubFetch(200, { beneficiary: { id: 'b1' }, message: 'internal detail' });
    const result = await setBeneficiary('tok', WRITE_BODY);
    expect(result).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    if (result.status === 'error') expect(result.message).not.toContain('internal detail');
  });
});

describe('removeBeneficiary', () => {
  it('DELETEs /v1/me/beneficiary with a Bearer header and returns success on a 200 envelope', async () => {
    const fetchFn = stubFetch(200, {
      beneficiary: null,
      notice: { code: 'KYC_REQUIRED_FOR_TRANSFER', message: 'x' },
    });
    const result = await removeBeneficiary('tok');
    expect(result).toEqual({
      status: 'success',
      beneficiary: null,
      notice: { code: 'KYC_REQUIRED_FOR_TRANSFER' },
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/beneficiary');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('treats a 404 as an idempotent success (nothing to delete)', async () => {
    stubFetch(404, { errorCode: 'NOT_FOUND' });
    const result = await removeBeneficiary('tok');
    expect(result).toEqual({ status: 'success', beneficiary: null, notice: null });
  });

  it('treats a 204/empty body as success', async () => {
    stubEmptyFetch(204);
    const result = await removeBeneficiary('tok');
    expect(result).toEqual({ status: 'success', beneficiary: null, notice: null });
  });

  it('maps transport statuses (401/429/0) — no VALIDATION_FAILED on a DELETE', async () => {
    stubFetch(401, {});
    expect(await removeBeneficiary('tok')).toMatchObject({ code: 'SESSION_EXPIRED' });
    stubFetch(429, {});
    expect(await removeBeneficiary('tok')).toMatchObject({ code: 'RATE_LIMITED' });
    stubFetch(500, {});
    expect(await removeBeneficiary('tok')).toMatchObject({ code: 'SERVER_ERROR' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await removeBeneficiary('tok')).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('maps a schema-invalid 200 body to SERVER_ERROR without leaking a raw message', async () => {
    stubFetch(200, { beneficiary: { id: 'b1' }, message: 'internal detail' });
    const result = await removeBeneficiary('tok');
    expect(result).toMatchObject({ status: 'error', code: 'SERVER_ERROR' });
    if (result.status === 'error') expect(result.message).not.toContain('internal detail');
  });
});
