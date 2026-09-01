import { describe, it, expect } from 'vitest';
import {
  computeLockupUntil,
  computeRetentionAmount,
  deriveArtworkSalt,
} from '../../../../src/modules/fractionalization/token-init';
import { deriveFractionTokenAddress } from '../../../../src/modules/fractionalization/soroban-fraction-factory.service';

const FACTORY = 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const ARTWORK = '00000000-0000-4000-8000-0000000a0001';

describe('token-init helpers', () => {
  it('deriveArtworkSalt is a deterministic 32-byte digest', () => {
    const a = deriveArtworkSalt(ARTWORK);
    const b = deriveArtworkSalt(ARTWORK);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
    expect(deriveArtworkSalt('other').equals(a)).toBe(false);
  });

  it('computeRetentionAmount floors (supply × pct / 100)', () => {
    expect(computeRetentionAmount('1000000', 10)).toBe('100000');
    expect(computeRetentionAmount('7', 33)).toBe('2'); // floor(2.31)
    expect(computeRetentionAmount('1000000', 0)).toBe('0');
  });

  it('computeRetentionAmount stays exact for large i128 supplies', () => {
    expect(computeRetentionAmount('79228162514264337593543950335', 50)).toBe(
      '39614081257132168796771975167',
    );
  });

  it('computeLockupUntil = deployTs + days × 86400', () => {
    expect(computeLockupUntil(1_000_000_000, 1)).toBe('1000086400');
    expect(computeLockupUntil(1_000_000_000, 0)).toBe('1000000000');
  });
});

describe('deriveFractionTokenAddress (golden-vector: off-chain deterministic address)', () => {
  it('is deterministic for (factory, artworkId, passphrase)', () => {
    const a = deriveFractionTokenAddress(FACTORY, ARTWORK, PASSPHRASE);
    const b = deriveFractionTokenAddress(FACTORY, ARTWORK, PASSPHRASE);
    expect(a).toBe(b);
    expect(a).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it('differs per artwork (salt = sha256(artworkId))', () => {
    expect(deriveFractionTokenAddress(FACTORY, ARTWORK, PASSPHRASE)).not.toBe(
      deriveFractionTokenAddress(FACTORY, '00000000-0000-4000-8000-0000000a0002', PASSPHRASE),
    );
  });
});
