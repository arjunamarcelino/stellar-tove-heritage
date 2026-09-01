import { describe, it, expect } from 'vitest';
import {
  mapConstructorArgs,
  assertPublicFloatMatches,
} from '../../../../src/modules/offerings/deploy/offering-escrow-args.mapper';
import { EscrowParamDriftError } from '../../../../src/modules/offerings/escrow/offering-escrow.errors';

/**
 * Unit specs for the `string → bigint` + config-address seam (TOV-154, WS7). Pure functions — no DI,
 * no repos. Mirrors the `backoffice-offerings.service.spec.ts` fixture style.
 */

const ARTIST = 'GARTIST00000000000000000000000000000000000000000000000000';

const CFG = {
  usdcAddress: 'CUSDC0000000000000000000000000000000000000000000000000000',
  treasuryAddress: 'CTREASURY000000000000000000000000000000000000000000000000',
  adminPublicKey: 'GADMIN00000000000000000000000000000000000000000000000000',
};

/** total_supply − artist_retention − treasury_retention = 1_000_000 − 100_000 − 50_000 = 850_000. */
const fc = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'fc1',
    totalSupply: '1000000',
    artistAddress: ARTIST,
    artistRetentionAmount: '100000',
    treasuryRetentionAmount: '50000',
    ...overrides,
  }) as never;

const off = (overrides: Record<string, unknown> = {}) =>
  ({ id: 'off1', publicFloat: '850000', ...overrides }) as never;

describe('mapConstructorArgs (U16)', () => {
  it('maps all 8 fields — addresses from cfg, supply/artist/retentions from fc, amounts as bigint', () => {
    const args = mapConstructorArgs(off(), fc(), CFG as never);

    expect(args).toEqual({
      usdc: CFG.usdcAddress,
      totalSupply: 1_000_000n,
      artist: ARTIST,
      artistRetention: 100_000n,
      treasury: CFG.treasuryAddress,
      treasuryRetention: 50_000n,
      artistPayout: ARTIST,
      admin: CFG.adminPublicKey,
    });
    // amounts are real bigints, not strings/numbers
    expect(typeof args.totalSupply).toBe('bigint');
    expect(typeof args.artistRetention).toBe('bigint');
    expect(typeof args.treasuryRetention).toBe('bigint');
    // artistPayout === artist (same live fraction_contracts address)
    expect(args.artistPayout).toBe(args.artist);
  });

  it('U16b: null artistRetentionAmount → EscrowParamDriftError (never BigInt(null) → 0n)', () => {
    expect(() => mapConstructorArgs(off(), fc({ artistRetentionAmount: null }), CFG as never)).toThrow(
      EscrowParamDriftError,
    );
  });

  it('U16b: null treasuryRetentionAmount → EscrowParamDriftError', () => {
    expect(() => mapConstructorArgs(off(), fc({ treasuryRetentionAmount: null }), CFG as never)).toThrow(
      EscrowParamDriftError,
    );
  });
});

describe('assertPublicFloatMatches (U17)', () => {
  it('exact match passes (no throw)', () => {
    expect(() => assertPublicFloatMatches(off({ publicFloat: '850000' }), fc())).not.toThrow();
  });

  it('off-by-one mismatch throws EscrowParamDriftError', () => {
    expect(() => assertPublicFloatMatches(off({ publicFloat: '849999' }), fc())).toThrow(
      EscrowParamDriftError,
    );
    expect(() => assertPublicFloatMatches(off({ publicFloat: '850001' }), fc())).toThrow(
      EscrowParamDriftError,
    );
  });

  it('null retention amount throws EscrowParamDriftError (cannot verify public_float)', () => {
    expect(() =>
      assertPublicFloatMatches(off(), fc({ artistRetentionAmount: null })),
    ).toThrow(EscrowParamDriftError);
    expect(() =>
      assertPublicFloatMatches(off(), fc({ treasuryRetentionAmount: null })),
    ).toThrow(EscrowParamDriftError);
  });
});
