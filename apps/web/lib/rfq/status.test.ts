import { describe, it, expect } from 'vitest';
import { rfqGateVerdict } from '@/lib/rfq/status';

// The RFQ gate ladder is independent of the offering subscription window — precedence only:
// anon → not-whitelisted → not-fractionalized → create.
describe('rfqGateVerdict', () => {
  it('anonymous viewer → sign-in gate', () => {
    expect(rfqGateVerdict({ isSignedIn: false, isWhitelisted: false })).toEqual({
      kind: 'gate',
      reason: 'anon',
    });
  });

  it('anon precedence wins even if somehow whitelisted', () => {
    expect(rfqGateVerdict({ isSignedIn: false, isWhitelisted: true })).toEqual({
      kind: 'gate',
      reason: 'anon',
    });
  });

  it('signed-in but not whitelisted → complete-KYC gate', () => {
    expect(rfqGateVerdict({ isSignedIn: true, isWhitelisted: false })).toEqual({
      kind: 'gate',
      reason: 'not-whitelisted',
    });
  });

  it('whitelisted + fractionalized flag known false → unavailable', () => {
    expect(
      rfqGateVerdict({ isSignedIn: true, isWhitelisted: true, fractionalized: false }),
    ).toEqual({
      kind: 'unavailable',
    });
  });

  it('whitelisted + fractionalized unknown (undefined) → create (render-and-error default)', () => {
    expect(rfqGateVerdict({ isSignedIn: true, isWhitelisted: true })).toEqual({ kind: 'create' });
  });

  it('whitelisted + fractionalized true → create', () => {
    expect(rfqGateVerdict({ isSignedIn: true, isWhitelisted: true, fractionalized: true })).toEqual(
      {
        kind: 'create',
      },
    );
  });
});
