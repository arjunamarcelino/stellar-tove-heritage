import { describe, it, expect } from 'vitest';
import { Address } from '@stellar/stellar-sdk';
import { walletToScVal } from '../../../../src/modules/kyc-allowlist/kyc-allowlist-encoding';
import { KycAllowlistBadAddressError } from '../../../../src/modules/kyc-allowlist/kyc-allowlist.errors';

const WALLET = 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME';
// Golden vector: the pinned XDR for `Address(WALLET)` as an scVal arg to add/remove/is_allowed. Regenerate
// only on a reviewed encoding change (TOV-233 lesson: fake-backed tests can't catch an on-chain shape bug).
const GOLDEN_B64 = 'AAAAEgAAAAFie8rJfNsjiWu+oPB+Z0LsjGwqSt5UcNhKxtfCIEai5w==';

// TOV-243 — a BYOW classic account (G…) golden vector. This encodes to the STRUCTURALLY-DIFFERENT
// `ScAddress → account` arm (an extra 4-byte PublicKey discriminant the contract arm lacks), so it must be
// pinned separately — the contract vector above cannot exercise this path. Pure function of the string
// (no keypair/network); regenerate only on a reviewed encoding change.
const G_WALLET = 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA';
const G_GOLDEN_B64 = 'AAAAEgAAAAAAAAAAdqS9ZaYb2q/R2amyGEaolFHIfwkHfmj2N0NiqDtUDJQ=';

describe('walletToScVal (KYC allowlist encoding)', () => {
  it('encodes a valid contract StrKey (C…) as the golden-vector Address scVal', () => {
    const scv = walletToScVal(WALLET);
    expect(scv.switch().name).toBe('scvAddress');
    expect(scv.toXDR('base64')).toBe(GOLDEN_B64);
    // round-trips to the same address
    expect(Address.fromScVal(scv).toString()).toBe(WALLET);
  });

  it('encodes a valid account StrKey (G…) as the golden-vector account-arm Address scVal (TOV-243)', () => {
    const scv = walletToScVal(G_WALLET);
    expect(scv.switch().name).toBe('scvAddress');
    expect(scv.toXDR('base64')).toBe(G_GOLDEN_B64);
    expect(Address.fromScVal(scv).toString()).toBe(G_WALLET);
  });

  it('rejects a shape-valid but checksum-invalid StrKey (typo guard)', () => {
    // Last char flipped E→F: matches ^C[A-Z2-7]{55}$ but fails the CRC16 checksum.
    expect(() => walletToScVal('CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBMF')).toThrow(
      KycAllowlistBadAddressError,
    );
  });

  // The LOAD-BEARING invariant: in stellar-sdk v15 `Address.fromString` ACCEPTS muxed (M…),
  // claimable-balance (B…), and liquidity-pool (L…) StrKeys (Protocol 23 / CAP-67), so the explicit-allowlist
  // guard — NOT Address.fromString — is the sole stop for these. Each case asserts BOTH facts, so if a future
  // SDK made fromString reject them (the guard becomes a mere backstop) or one literal is malformed, this
  // fails loudly instead of silently passing. (Literals verified against the installed SDK.)
  it.each([
    ['muxed M-address', 'MB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJIAAAAAAAAAAAAHKSA'],
    ['claimable-balance B-address', 'BADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOB7GHU'],
    ['liquidity-pool L-address', 'LADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQPEA4'],
  ])('rejects %s that Address.fromString accepts — the guard is the sole stop', (_label, bad) => {
    expect(() => Address.fromString(bad)).not.toThrow(); // invariant: the SDK accepts it…
    expect(() => walletToScVal(bad)).toThrow(KycAllowlistBadAddressError); // …so our guard must reject it
  });

  it.each([
    // (checksum failure is covered by the standalone test above; one lowercase case proves "no normalization".)
    ['lowercase G-address', 'gb3kjplfuyn5vl6r3gu3egcgvckfdsd7bedx42hwg5bwfkb3kqgjjrma'],
    ['too short', 'CBRHXSWJ'],
    ['empty', ''],
  ])('rejects a malformed StrKey (Address.fromString also rejects): %s', (_label, bad) => {
    expect(() => walletToScVal(bad)).toThrow(KycAllowlistBadAddressError);
  });
});
