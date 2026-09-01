import { describe, it, expect } from 'vitest';
import { quoteGateVerdict } from '@/lib/quote/status';

describe('quoteGateVerdict', () => {
  it('anon takes precedence over everything', () => {
    expect(quoteGateVerdict({ isSignedIn: false, isWhitelisted: true, readFailed: true })).toEqual({
      kind: 'gate',
      reason: 'anon',
    });
  });

  it('a whitelist read failure → load-error (NOT the KYC gate) for a signed-in viewer', () => {
    expect(quoteGateVerdict({ isSignedIn: true, isWhitelisted: false, readFailed: true })).toEqual({
      kind: 'load-error',
    });
  });

  it('signed-in but not whitelisted (read succeeded) → complete-KYC gate', () => {
    expect(quoteGateVerdict({ isSignedIn: true, isWhitelisted: false })).toEqual({
      kind: 'gate',
      reason: 'not-whitelisted',
    });
  });

  it('signed-in + whitelisted → submit', () => {
    expect(quoteGateVerdict({ isSignedIn: true, isWhitelisted: true })).toEqual({ kind: 'submit' });
  });
});
