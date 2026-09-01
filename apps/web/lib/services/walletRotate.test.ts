import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SOURCE_WALLET_ID,
  DEST_WALLET_ID,
  fakeRotateInitiate200,
  fakeRotateSubmit200,
  fakeRotateStatusConfirmed,
  fakeRotateStatusNone,
  fakeRotateCancel200,
  fakeSignedItems,
  fakeBlockedByLockup422,
  fakeNotPrimary409,
  fakeConflict409,
  fakeNothingToTransfer422,
  fakeNotWhitelisted422,
  fakeCannotCancel409,
} from '@/test/fixtures/walletRotate';

vi.mock('server-only', () => ({}));

import {
  rotateInitiate,
  rotateSubmit,
  rotateStatus,
  rotateCancel,
} from '@/lib/services/walletRotate';

const OLD_ENV = process.env;

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

describe('rotateInitiate', () => {
  it('POSTs { destinationWalletId } with Bearer and returns the parsed begin data', async () => {
    const fetchFn = stubFetch(200, fakeRotateInitiate200);
    const result = await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID);
    expect(result).toEqual({ status: 'success', data: fakeRotateInitiate200 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/me/wallets/${SOURCE_WALLET_ID}/rotate-transfer`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ destinationWalletId: DEST_WALLET_ID });
  });

  it('surfaces lockupExpiresAt on ROTATION_BLOCKED_BY_LOCKUP and uses curated copy (not the raw message)', async () => {
    stubFetch(422, fakeBlockedByLockup422);
    const result = await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID);
    expect(result).toMatchObject({
      status: 'error',
      code: 'ROTATION_BLOCKED_BY_LOCKUP',
      lockupExpiresAt: '2026-11-04T00:00:00.000Z',
    });
    if (result.status === 'error') {
      expect(result.message).not.toBe(fakeBlockedByLockup422.message);
    }
  });

  it('maps the initiate error codes distinctly', async () => {
    stubFetch(409, fakeNotPrimary409);
    expect(await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'ROTATION_DESTINATION_NOT_PRIMARY',
    });
    stubFetch(409, fakeConflict409);
    expect(await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'ROTATION_CONFLICT',
    });
    stubFetch(422, fakeNothingToTransfer422);
    expect(await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'ROTATION_NOTHING_TO_TRANSFER',
    });
    stubFetch(422, fakeNotWhitelisted422);
    expect(await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'RECIPIENT_NOT_WHITELISTED',
    });
  });

  it('falls back to NETWORK_ERROR on status 0 and SERVER_ERROR on an invalid success body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'NETWORK_ERROR',
    });
    stubFetch(200, { rotationId: 'x' }); // missing items/status
    expect(await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'SERVER_ERROR',
    });
  });

  it('rejects a malformed amountScaled at the parse boundary', async () => {
    const bad = {
      ...fakeRotateInitiate200,
      items: [{ ...fakeRotateInitiate200.items[0], amountScaled: '1e21' }],
    };
    stubFetch(200, bad);
    expect(await rotateInitiate('tok', SOURCE_WALLET_ID, DEST_WALLET_ID)).toMatchObject({
      code: 'SERVER_ERROR',
    });
  });
});

describe('rotateSubmit', () => {
  it('POSTs { items } to /submit and returns the submitting state', async () => {
    const fetchFn = stubFetch(200, fakeRotateSubmit200);
    const result = await rotateSubmit('tok', SOURCE_WALLET_ID, fakeSignedItems);
    expect(result).toEqual({ status: 'success', data: fakeRotateSubmit200 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/me/wallets/${SOURCE_WALLET_ID}/rotate-transfer/submit`);
    expect(JSON.parse(init.body)).toEqual({ items: fakeSignedItems });
  });

  it('maps 404 ROTATION_NOT_FOUND and 422 RECIPIENT_NOT_WHITELISTED', async () => {
    stubFetch(404, { errorCode: 'ROTATION_NOT_FOUND' });
    expect(await rotateSubmit('tok', SOURCE_WALLET_ID, fakeSignedItems)).toMatchObject({
      code: 'ROTATION_NOT_FOUND',
    });
    stubFetch(422, fakeNotWhitelisted422);
    expect(await rotateSubmit('tok', SOURCE_WALLET_ID, fakeSignedItems)).toMatchObject({
      code: 'RECIPIENT_NOT_WHITELISTED',
    });
  });

  it('parses a confirmed item with a null txHash/ledger (best-effort hash)', async () => {
    stubFetch(200, {
      rotationId: 'r1',
      status: 'submitting',
      items: [
        {
          itemId: 'i1',
          tokenContract: 'CA1',
          amountScaled: '5',
          status: 'confirmed',
          txHash: null,
          ledger: null,
        },
      ],
    });
    expect(await rotateSubmit('tok', SOURCE_WALLET_ID, fakeSignedItems)).toMatchObject({
      status: 'success',
    });
  });
});

describe('rotateStatus', () => {
  it('GETs /status and returns the parsed reconciliation state (with destination echo)', async () => {
    const fetchFn = stubFetch(200, fakeRotateStatusConfirmed);
    const result = await rotateStatus('tok', SOURCE_WALLET_ID);
    expect(result).toEqual({ status: 'success', data: fakeRotateStatusConfirmed });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/me/wallets/${SOURCE_WALLET_ID}/rotate-transfer/status`);
    expect(init.method).toBe('GET');
  });

  it('accepts the empty "none" state (no rotation in flight)', async () => {
    stubFetch(200, fakeRotateStatusNone);
    expect(await rotateStatus('tok', SOURCE_WALLET_ID)).toMatchObject({
      status: 'success',
      data: { state: 'none' },
    });
  });

  it('maps 401 to SESSION_EXPIRED', async () => {
    stubFetch(401, {});
    expect(await rotateStatus('tok', SOURCE_WALLET_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});

describe('rotateCancel', () => {
  it('DELETEs and returns the canceledId', async () => {
    const fetchFn = stubFetch(200, fakeRotateCancel200);
    const result = await rotateCancel('tok', SOURCE_WALLET_ID);
    expect(result).toEqual({ status: 'success', canceledId: fakeRotateCancel200.canceledId });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/me/wallets/${SOURCE_WALLET_ID}/rotate-transfer`);
    expect(init.method).toBe('DELETE');
  });

  it('maps 409 ROTATION_CANNOT_CANCEL and 404 ROTATION_NOT_FOUND', async () => {
    stubFetch(409, fakeCannotCancel409);
    expect(await rotateCancel('tok', SOURCE_WALLET_ID)).toMatchObject({
      code: 'ROTATION_CANNOT_CANCEL',
    });
    stubFetch(404, { errorCode: 'ROTATION_NOT_FOUND' });
    expect(await rotateCancel('tok', SOURCE_WALLET_ID)).toMatchObject({
      code: 'ROTATION_NOT_FOUND',
    });
  });
});
