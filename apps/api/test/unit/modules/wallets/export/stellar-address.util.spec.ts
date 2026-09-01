import { describe, it, expect } from 'vitest';
import {
  canonicalizeStellarAddress,
  isStellarAccountAddress,
} from '../../../../../src/modules/wallets/export/stellar-address.util';

const G_ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const C_ADDRESS = 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI';

describe('canonicalizeStellarAddress', () => {
  it('round-trips a valid G-address unchanged (already canonical)', () => {
    expect(canonicalizeStellarAddress(G_ADDRESS)).toBe(G_ADDRESS);
  });

  it('round-trips a valid C-address unchanged', () => {
    expect(canonicalizeStellarAddress(C_ADDRESS)).toBe(C_ADDRESS);
  });

  it('strips surrounding whitespace', () => {
    expect(canonicalizeStellarAddress(`  ${G_ADDRESS}\n`)).toBe(G_ADDRESS);
  });

  it('rejects a lowercased StrKey (never coerces case)', () => {
    expect(() => canonicalizeStellarAddress(G_ADDRESS.toLowerCase())).toThrow();
  });

  it('rejects garbage / muxed / empty input', () => {
    expect(() => canonicalizeStellarAddress('not-an-address')).toThrow();
    expect(() => canonicalizeStellarAddress('')).toThrow();
    // Muxed M-address is not a plain account/contract key.
    expect(() =>
      canonicalizeStellarAddress('MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAE2BQ6'),
    ).toThrow();
  });
});

describe('isStellarAccountAddress', () => {
  it('accepts a G-address', () => {
    expect(isStellarAccountAddress(G_ADDRESS)).toBe(true);
  });

  it('rejects a C-address (not a self-custody account)', () => {
    expect(isStellarAccountAddress(C_ADDRESS)).toBe(false);
  });
});
