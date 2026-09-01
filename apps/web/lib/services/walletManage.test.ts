import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeAddedByowWallet } from '@/test/fixtures/walletExport';

vi.mock('server-only', () => ({}));

import {
  addWalletChallenge,
  addWallet,
  removeWallet,
  setPrimaryWallet,
} from '@/lib/services/walletManage';

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

describe('addWalletChallenge', () => {
  it('POSTs the publicKey with a Bearer header and returns the parsed challenge', async () => {
    const fetchFn = stubFetch(200, {
      challengeTxXdr: 'AAAA==',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    const result = await addWalletChallenge('tok', 'GPUBKEY');
    expect(result).toEqual({
      status: 'success',
      challengeTxXdr: 'AAAA==',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/wallets/challenge');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ publicKey: 'GPUBKEY' });
  });

  it('maps a 400 to VALIDATION_FAILED', async () => {
    stubFetch(400, { errorCode: 'VALIDATION_FAILED' });
    expect(await addWalletChallenge('tok', 'bad')).toMatchObject({
      status: 'error',
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('addWallet', () => {
  it('POSTs the signed XDR with a Bearer + Idempotency-Key header and returns the wallet on 201', async () => {
    const fetchFn = stubFetch(201, fakeAddedByowWallet);
    const result = await addWallet('tok', 'SIGNED==', 'idem-key-1');
    expect(result).toEqual({ status: 'success', wallet: fakeAddedByowWallet });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/wallets');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Idempotency-Key']).toBe('idem-key-1');
    expect(JSON.parse(init.body)).toEqual({ signedChallengeXdr: 'SIGNED==' });
  });

  it('maps WALLET_ALREADY_BOUND (409) and AUTH_SIGNATURE_INVALID (401) from the errorCode', async () => {
    stubFetch(409, { errorCode: 'WALLET_ALREADY_BOUND' });
    expect(await addWallet('tok', 's', 'k')).toMatchObject({
      status: 'error',
      code: 'WALLET_ALREADY_BOUND',
    });
    stubFetch(401, { errorCode: 'AUTH_SIGNATURE_INVALID' });
    expect(await addWallet('tok', 's', 'k')).toMatchObject({
      status: 'error',
      code: 'AUTH_SIGNATURE_INVALID',
    });
  });

  it('passes through all four 401 AUTH_* codes; a 401 without an errorCode falls back to SESSION_EXPIRED', async () => {
    for (const code of [
      'AUTH_SIGNATURE_INVALID',
      'AUTH_CHALLENGE_NOT_FOUND',
      'AUTH_CHALLENGE_EXPIRED',
      'AUTH_CHALLENGE_ALREADY_USED',
    ] as const) {
      stubFetch(401, { errorCode: code });
      expect(await addWallet('tok', 's', 'k')).toMatchObject({ status: 'error', code });
    }
    // Assumption (documented in addStatusFallback): a 401 carrying no errorCode is a real session expiry.
    stubFetch(401, {});
    expect(await addWallet('tok', 's', 'k')).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
  });

  it('passes through the split idempotency codes: 409 IN_FLIGHT and 422 MISMATCH', async () => {
    stubFetch(409, { errorCode: 'IDEMPOTENCY_KEY_IN_FLIGHT' });
    expect(await addWallet('tok', 's', 'k')).toMatchObject({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
    });
    stubFetch(422, { errorCode: 'IDEMPOTENCY_KEY_MISMATCH' });
    expect(await addWallet('tok', 's', 'k')).toMatchObject({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_MISMATCH',
    });
  });

  it('returns SERVER_ERROR when the 201 body fails schema validation', async () => {
    stubFetch(201, { id: 'w', kind: 'unknown-kind', address: 'C', exported: false });
    expect(await addWallet('tok', 's', 'k')).toMatchObject({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('parses the trustlineRequired bundle from a 201 body (BYOW USDC)', async () => {
    stubFetch(201, {
      ...fakeAddedByowWallet,
      trustlineRequired: {
        changeTrustXdr: 'AAAA...',
        asset: { code: 'USDC', issuer: 'GBBD47IF...' },
      },
    });
    const result = await addWallet('tok', 's', 'k');
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.wallet.trustlineRequired).toEqual({
        changeTrustXdr: 'AAAA...',
        asset: { code: 'USDC', issuer: 'GBBD47IF...' },
      });
    }
  });

  it('leaves trustlineRequired undefined when the 201 body omits it', async () => {
    stubFetch(201, fakeAddedByowWallet);
    const result = await addWallet('tok', 's', 'k');
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.wallet.trustlineRequired).toBeUndefined();
    }
  });

  it('normalizes a null trustlineRequired to undefined (forward-compat)', async () => {
    stubFetch(201, { ...fakeAddedByowWallet, trustlineRequired: null });
    const result = await addWallet('tok', 's', 'k');
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.wallet.trustlineRequired).toBeUndefined();
    }
  });
});

describe('removeWallet', () => {
  it('DELETEs /v1/me/wallets/:id with a Bearer header; 200 body → success + newPrimaryWalletId', async () => {
    const fetchFn = stubFetch(200, { deletedId: 'wallet-123', newPrimaryWalletId: null });
    const result = await removeWallet('tok', 'wallet-123');
    expect(result).toEqual({ status: 'success', newPrimaryWalletId: null });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/wallets/wallet-123');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.body).toBeUndefined();
  });

  it('surfaces the auto-promoted sibling id when the primary was deleted (TOV-25)', async () => {
    stubFetch(200, { deletedId: 'p', newPrimaryWalletId: 'sibling-9' });
    expect(await removeWallet('tok', 'p')).toEqual({
      status: 'success',
      newPrimaryWalletId: 'sibling-9',
    });
  });

  it('still resolves to success when the 200 body is missing/legacy (defensive)', async () => {
    stubFetch(200, null); // e.g. an old 204-style empty body
    expect(await removeWallet('tok', 'w')).toEqual({ status: 'success', newPrimaryWalletId: null });
  });

  it('maps the backend errorCode for 409 / 422 / 404', async () => {
    stubFetch(409, { errorCode: 'PRIMARY_WALLET_CANNOT_BE_REMOVED' });
    expect(await removeWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'PRIMARY_WALLET_CANNOT_BE_REMOVED',
    });
    stubFetch(422, { errorCode: 'WALLET_KIND_NOT_SUPPORTED' });
    expect(await removeWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'WALLET_KIND_NOT_SUPPORTED',
    });
    stubFetch(404, { errorCode: 'WALLET_NOT_FOUND' });
    expect(await removeWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'WALLET_NOT_FOUND',
    });
  });

  it('falls back on status when there is no errorCode (401 → SESSION_EXPIRED, 0 → NETWORK_ERROR)', async () => {
    stubFetch(401, {});
    expect(await removeWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await removeWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });

  it('never surfaces a raw backend message (curated copy only)', async () => {
    stubFetch(409, {
      errorCode: 'PRIMARY_WALLET_CANNOT_BE_REMOVED',
      message: 'raw backend detail',
    });
    const result = await removeWallet('tok', 'w');
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).not.toContain('raw backend detail');
  });
});

describe('setPrimaryWallet', () => {
  it('POSTs /v1/me/wallets/:id/primary with a Bearer header and no body; 200 → success', async () => {
    const fetchFn = stubFetch(200, { ...fakeAddedByowWallet, isPrimary: true });
    const result = await setPrimaryWallet('tok', 'wallet-123');
    expect(result).toEqual({ status: 'success' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/v1/me/wallets/wallet-123/primary');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    // No request body per contract (JSON.stringify(undefined) === undefined). Note: unlike the DELETE
    // path, a POST still carries Content-Type — do not assert its absence.
    expect(init.body).toBeUndefined();
  });

  it('URL-encodes the wallet id in the path', async () => {
    const fetchFn = stubFetch(200, {});
    await setPrimaryWallet('tok', 'a/b?c');
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.test/v1/me/wallets/a%2Fb%3Fc/primary');
  });

  it('treats the idempotent no-op (200, already-primary DTO) as success', async () => {
    stubFetch(200, { ...fakeAddedByowWallet, isPrimary: true });
    expect(await setPrimaryWallet('tok', 'w')).toEqual({ status: 'success' });
  });

  it('maps the backend errorCode for 404 / 422 / 409 / 429', async () => {
    stubFetch(404, { errorCode: 'WALLET_NOT_FOUND' });
    expect(await setPrimaryWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'WALLET_NOT_FOUND',
    });
    stubFetch(422, { errorCode: 'WALLET_KIND_NOT_SUPPORTED' });
    expect(await setPrimaryWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'WALLET_KIND_NOT_SUPPORTED',
    });
    stubFetch(409, { errorCode: 'WALLET_NOT_ELIGIBLE_FOR_PRIMARY' });
    expect(await setPrimaryWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'WALLET_NOT_ELIGIBLE_FOR_PRIMARY',
    });
    stubFetch(429, { errorCode: 'RATE_LIMITED' });
    expect(await setPrimaryWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED',
    });
  });

  it('falls back on status when there is no errorCode (401 → SESSION_EXPIRED, 0 → NETWORK_ERROR)', async () => {
    stubFetch(401, {});
    expect(await setPrimaryWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await setPrimaryWallet('tok', 'w')).toMatchObject({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });

  it('never surfaces a raw backend message (curated copy only)', async () => {
    stubFetch(409, { errorCode: 'WALLET_NOT_ELIGIBLE_FOR_PRIMARY', message: 'raw backend detail' });
    const result = await setPrimaryWallet('tok', 'w');
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).not.toContain('raw backend detail');
  });
});
