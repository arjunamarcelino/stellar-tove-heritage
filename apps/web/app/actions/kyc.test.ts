import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  submitKyc: vi.fn(),
  getWhitelistStatus: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/kyc', () => ({
  submitKyc: h.submitKyc,
  getWhitelistStatus: h.getWhitelistStatus,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));

import { submitKycAction, refreshWhitelistStatusAction } from '@/app/actions/kyc';

const KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function file(name: string, type: string, bytes = 'x'): File {
  return new File([bytes], name, { type });
}

// A complete, valid multipart payload including the client-minted key field.
function validForm(): FormData {
  const fd = new FormData();
  fd.set('idempotencyKey', KEY);
  fd.set('claimedJurisdiction', 'GB');
  fd.set('gov_id_front', file('front.jpg', 'image/jpeg'));
  fd.set('gov_id_back', file('back.jpg', 'image/jpeg'));
  fd.set('proof_of_address', file('poa.pdf', 'application/pdf'));
  fd.set('selfie', file('selfie.png', 'image/png'));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' }); // authenticated by default
});

describe('submitKycAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await submitKycAction(validForm())).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.submitKyc).not.toHaveBeenCalled();
  });

  it('rejects a missing/non-uuid idempotency key before delegating', async () => {
    const fd = validForm();
    fd.set('idempotencyKey', 'not-a-uuid');
    expect(await submitKycAction(fd)).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.submitKyc).not.toHaveBeenCalled();
  });

  it('rejects a payload missing a document before delegating', async () => {
    const fd = validForm();
    fd.delete('selfie');
    expect(await submitKycAction(fd)).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.submitKyc).not.toHaveBeenCalled();
  });

  it('rejects an off-allowlist jurisdiction before delegating', async () => {
    const fd = validForm();
    fd.set('claimedJurisdiction', 'NG');
    expect(await submitKycAction(fd)).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.submitKyc).not.toHaveBeenCalled();
  });

  it('rejects an oversized file before delegating', async () => {
    const fd = validForm();
    // 11 MB > the 10 MB cap
    fd.set('gov_id_front', file('big.jpg', 'image/jpeg', 'x'.repeat(11 * 1024 * 1024)));
    expect(await submitKycAction(fd)).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.submitKyc).not.toHaveBeenCalled();
  });

  it('delegates with the cookie token + key on a valid payload and strips the key field', async () => {
    h.submitKyc.mockResolvedValue({
      status: 'success',
      submissionId: 's1',
      kycStatus: 'pending_review',
    });
    const fd = validForm();
    const result = await submitKycAction(fd);
    expect(result).toMatchObject({ status: 'success', submissionId: 's1' });
    expect(h.submitKyc).toHaveBeenCalledTimes(1);
    const [token, forwarded, key] = h.submitKyc.mock.calls[0];
    expect(token).toBe('tok');
    expect(key).toBe(KEY);
    // The key field is stripped before forwarding (backend gets only files + claimedJurisdiction).
    expect(forwarded.get('idempotencyKey')).toBeNull();
    expect(forwarded.get('claimedJurisdiction')).toBe('GB');
  });
});

describe('refreshWhitelistStatusAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await refreshWhitelistStatusAction()).toMatchObject({
      status: 'error',
      code: 'SESSION_EXPIRED',
    });
    expect(h.getWhitelistStatus).not.toHaveBeenCalled();
  });

  it('delegates to the service with the cookie token', async () => {
    const success = { status: 'success', data: { status: 'whitelisted', whitelistedAt: 'x' } };
    h.getWhitelistStatus.mockResolvedValue(success);
    expect(await refreshWhitelistStatusAction()).toBe(success);
    expect(h.getWhitelistStatus).toHaveBeenCalledWith('tok');
  });
});
