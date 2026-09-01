import { describe, it, expect } from 'vitest';

import { ApiError } from '@/types/api';

import { actionErrorCopy, friendlyFailure, mapAllowlistResult } from './allowlist-display';
import type { AllowlistItemResult } from './schemas';

const base: AllowlistItemResult = {
  wallet: 'C' + 'A'.repeat(55),
  action: 'add',
  status: 'confirmed',
  isAllowed: true,
  txHash: 'a'.repeat(64),
  errorReason: null,
};

describe('mapAllowlistResult', () => {
  it('confirmed add → success toast, tx link, NULL pill (cache owns confirmed pill) (positive)', () => {
    expect(mapAllowlistResult(base)).toEqual({
      pill: null,
      toast: 'success',
      message: 'Wallet added to the allowlist',
      txHash: base.txHash,
    });
  });

  it('confirmed remove (isAllowed false) → removed message, null pill', () => {
    const out = mapAllowlistResult({ ...base, action: 'remove', isAllowed: false });
    expect(out.pill).toBeNull();
    expect(out.toast).toBe('success');
    expect(out.message).toBe('Wallet removed from the allowlist');
  });

  it('noop → info toast, null pill, no tx link (edge)', () => {
    const out = mapAllowlistResult({ ...base, status: 'noop', txHash: null });
    expect(out).toMatchObject({ pill: null, toast: 'info', txHash: null });
  });

  it('pending → pending pill + tx link (edge)', () => {
    const out = mapAllowlistResult({ ...base, status: 'pending', isAllowed: null });
    expect(out).toMatchObject({ pill: 'pending', toast: 'info' });
    expect(out.txHash).toBe(base.txHash);
  });

  it('deferred → deferred pill, no tx link (edge)', () => {
    const out = mapAllowlistResult({ ...base, status: 'deferred', isAllowed: null, txHash: null });
    expect(out).toMatchObject({ pill: 'deferred', toast: 'info', txHash: null });
  });

  it('failed → error toast, NO pill change, NEVER raw errorReason (negative)', () => {
    const out = mapAllowlistResult({
      ...base,
      status: 'failed',
      isAllowed: null,
      txHash: null,
      errorReason: 'raw backend/chain detail that must not leak',
    });
    expect(out.pill).toBeNull();
    expect(out.toast).toBe('error');
    expect(out.message).not.toContain('raw backend');
    expect(out.txHash).toBeNull();
  });
});

describe('friendlyFailure', () => {
  it('maps a known code and falls back for unknown/undefined', () => {
    expect(friendlyFailure('TX_SUBMIT_FAILED')).toMatch(/submission failed/i);
    expect(friendlyFailure('SOMETHING_INTERNAL')).toBe('Action failed — please try again');
    expect(friendlyFailure(null)).toBe('Action failed — please try again');
  });
});

describe('actionErrorCopy', () => {
  it('maps status codes to safe copy, never a raw message', () => {
    expect(actionErrorCopy(new ApiError('leak', 403, 'FORBIDDEN'))).toMatch(/superadmin/i);
    expect(actionErrorCopy(new ApiError('leak', 429, 'RATE_LIMITED'))).toMatch(/too many/i);
    expect(actionErrorCopy(new ApiError('leak', 401, 'X'))).toMatch(/session/i);
    expect(actionErrorCopy(new ApiError('sensitive internals', 400, 'VALIDATION_ERROR'))).toBe(
      'Something went wrong — please try again',
    );
    expect(actionErrorCopy(new Error('boom'))).toBe('Something went wrong — please try again');
  });
});
