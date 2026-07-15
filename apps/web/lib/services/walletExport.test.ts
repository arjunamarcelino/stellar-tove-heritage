import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fakeExportBegin200,
  fakeSubmit200,
  fakeStatusConfirmed,
  fakeNotWhitelisted422,
  fakeExportNotAvailable422,
  fakeAlreadyExported409,
} from '@/test/fixtures/walletExport';

vi.mock('server-only', () => ({}));

import { exportBegin, exportSubmit, exportStatus } from '@/lib/services/walletExport';

const OLD_ENV = process.env;
const WALLET_ID = '11111111-1111-1111-1111-111111111111';

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('exportBegin', () => {
  it('POSTs { targetAddress } with Bearer and returns the parsed begin data', async () => {
    const fetchFn = stubFetch(200, fakeExportBegin200);
    const result = await exportBegin('tok', WALLET_ID, fakeExportBegin200.targetAddress);
    expect(result).toEqual({ status: 'success', data: fakeExportBegin200 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/me/wallets/${WALLET_ID}/export`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ targetAddress: fakeExportBegin200.targetAddress });
  });

  it('maps 422 RECIPIENT_NOT_WHITELISTED from the backend errorCode', async () => {
    stubFetch(422, fakeNotWhitelisted422);
    expect(await exportBegin('tok', WALLET_ID, 'G…')).toMatchObject({
      status: 'error',
      code: 'RECIPIENT_NOT_WHITELISTED',
    });
  });

  it('maps 422 EXPORT_NOT_AVAILABLE and 409 ALREADY_EXPORTED distinctly', async () => {
    stubFetch(422, fakeExportNotAvailable422);
    expect(await exportBegin('tok', WALLET_ID, 'G…')).toMatchObject({
      status: 'error',
      code: 'EXPORT_NOT_AVAILABLE',
    });
    stubFetch(409, fakeAlreadyExported409);
    expect(await exportBegin('tok', WALLET_ID, 'G…')).toMatchObject({
      status: 'error',
      code: 'ALREADY_EXPORTED',
    });
  });

  it('falls back to VALIDATION_FAILED on a bare 400 and NETWORK_ERROR on status 0', async () => {
    stubFetch(400, {});
    expect(await exportBegin('tok', WALLET_ID, 'G…')).toMatchObject({ code: 'VALIDATION_FAILED' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await exportBegin('tok', WALLET_ID, 'G…')).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('returns SERVER_ERROR when the success body fails validation', async () => {
    stubFetch(200, { exportId: 'x' }); // missing items/credentialId/etc.
    expect(await exportBegin('tok', WALLET_ID, 'G…')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('rejects a malformed amount/decimals at the parse boundary (todo 062)', async () => {
    const bad = {
      ...fakeExportBegin200,
      items: [{ ...fakeExportBegin200.items[0], amountScaled: '1e21', decimals: -3 }],
    };
    stubFetch(200, bad);
    expect(await exportBegin('tok', WALLET_ID, 'G…')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });
});

describe('exportSubmit', () => {
  const signed = [{ itemId: 'i1', authenticatorData: 'a', clientDataJSON: 'c', signature: 's' }];

  it('POSTs { exportId, items } to /submit and returns the submitting state', async () => {
    const fetchFn = stubFetch(200, fakeSubmit200);
    const result = await exportSubmit('tok', WALLET_ID, 'exp-1', signed);
    expect(result).toEqual({ status: 'success', data: fakeSubmit200 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/me/wallets/${WALLET_ID}/export/submit`);
    expect(JSON.parse(init.body)).toEqual({ exportId: 'exp-1', items: signed });
  });

  it('maps a per-item transfer error code from the backend', async () => {
    stubFetch(422, { errorCode: 'TRANSFER_EXPIRED', message: 'expired' });
    expect(await exportSubmit('tok', WALLET_ID, 'exp-1', signed)).toMatchObject({
      status: 'error',
      code: 'TRANSFER_EXPIRED',
    });
  });

  it('uses curated copy for TRANSFER_* codes, not the raw backend message (todo 065)', async () => {
    stubFetch(422, {
      errorCode: 'TRANSFER_FAILED',
      message: 'HostError: contract CA… trapped: UnreachableCodeReached ledger 123',
    });
    const result = await exportSubmit('tok', WALLET_ID, 'exp-1', signed);
    expect(result).toMatchObject({ status: 'error', code: 'TRANSFER_FAILED' });
    if (result.status === 'error') {
      expect(result.message).not.toContain('HostError');
      expect(result.message).toBe('The transfer didn’t go through.');
    }
  });

  it('maps 422 EXPORT_NOT_FOUND', async () => {
    stubFetch(422, { errorCode: 'EXPORT_NOT_FOUND' });
    expect(await exportSubmit('tok', WALLET_ID, 'exp-1', signed)).toMatchObject({
      code: 'EXPORT_NOT_FOUND',
    });
  });

  it('falls back to HTTP status for an unrecognized/client-only backend code (todo 063)', async () => {
    // Not a backend-emittable code → must not pass through; falls back to the 422 → SERVER_ERROR.
    stubFetch(422, { errorCode: 'SESSION_EXPIRED', message: 'nope' });
    expect(await exportSubmit('tok', WALLET_ID, 'exp-1', signed)).toMatchObject({
      code: 'SERVER_ERROR',
    });
  });
});

describe('exportStatus', () => {
  it('GETs /export/status and returns the parsed reconciliation state', async () => {
    const fetchFn = stubFetch(200, fakeStatusConfirmed);
    const result = await exportStatus('tok', WALLET_ID);
    expect(result).toEqual({ status: 'success', data: fakeStatusConfirmed });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/me/wallets/${WALLET_ID}/export/status`);
    expect(init.method).toBe('GET');
  });

  it('accepts the empty "none" state (no export in flight)', async () => {
    stubFetch(200, { exportId: null, state: 'none', items: [] });
    expect(await exportStatus('tok', WALLET_ID)).toMatchObject({
      status: 'success',
      data: { state: 'none' },
    });
  });

  it('maps 401 to SESSION_EXPIRED', async () => {
    stubFetch(401, {});
    expect(await exportStatus('tok', WALLET_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
