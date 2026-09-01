import { describe, it, expect } from 'vitest';
import {
  deriveOfferingEscrowAddress,
  escrowSalt,
} from '../../../../src/modules/offerings/escrow/offering-escrow-address';
import { deriveOfferingEscrowAddressFor } from '../../../../src/modules/offerings/escrow/soroban-offering-escrow.service';
import {
  FIXTURE_ADMIN_PUBLIC_KEY,
  FIXTURE_OFFERING_ID,
  FIXTURE_GOLDEN_ESCROW_ADDRESS,
  TESTNET_PASSPHRASE,
} from '../../../shared/fixtures/offering-escrow.fixtures';

const CONTRACT_STRKEY_RE = /^C[A-Z2-7]{55}$/;

/**
 * Golden-vector guard on the OFF-CHAIN deterministic escrow-address derivation (pure, no network). The
 * worker pins this address before submit and self-heals against it after a crash, so a drift here would
 * silently corrupt every deploy. Pinned against the fixture golden address the WS5 author produced.
 */
describe('escrowSalt', () => {
  it('is a deterministic 32-byte Buffer for a given offering id', () => {
    const a = escrowSalt(FIXTURE_OFFERING_ID);
    const b = escrowSalt(FIXTURE_OFFERING_ID);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
  });

  it('produces a different salt for a different offering id', () => {
    expect(escrowSalt(FIXTURE_OFFERING_ID).equals(escrowSalt('other-offering-id'))).toBe(false);
  });
});

describe('deriveOfferingEscrowAddress (golden vector)', () => {
  const salt = escrowSalt(FIXTURE_OFFERING_ID);

  it('returns a valid C… contract StrKey', () => {
    const addr = deriveOfferingEscrowAddress(FIXTURE_ADMIN_PUBLIC_KEY, salt, TESTNET_PASSPHRASE);
    expect(addr).toMatch(CONTRACT_STRKEY_RE);
  });

  it('equals the pinned golden address for the fixed (deployer, salt, passphrase)', () => {
    const addr = deriveOfferingEscrowAddress(FIXTURE_ADMIN_PUBLIC_KEY, salt, TESTNET_PASSPHRASE);
    expect(addr).toBe(FIXTURE_GOLDEN_ESCROW_ADDRESS);
  });

  it('is deterministic (same inputs → same address)', () => {
    const a = deriveOfferingEscrowAddress(FIXTURE_ADMIN_PUBLIC_KEY, salt, TESTNET_PASSPHRASE);
    const b = deriveOfferingEscrowAddress(FIXTURE_ADMIN_PUBLIC_KEY, salt, TESTNET_PASSPHRASE);
    expect(a).toBe(b);
  });

  it('yields a different address for a different salt', () => {
    const otherSalt = escrowSalt('a-different-offering');
    const addr = deriveOfferingEscrowAddress(FIXTURE_ADMIN_PUBLIC_KEY, otherSalt, TESTNET_PASSPHRASE);
    expect(addr).not.toBe(FIXTURE_GOLDEN_ESCROW_ADDRESS);
    expect(addr).toMatch(CONTRACT_STRKEY_RE);
  });
});

describe('deriveOfferingEscrowAddressFor (offeringId convenience wrapper)', () => {
  it('matches the salt-based derivation and the golden address', () => {
    const addr = deriveOfferingEscrowAddressFor(
      FIXTURE_ADMIN_PUBLIC_KEY,
      FIXTURE_OFFERING_ID,
      TESTNET_PASSPHRASE,
    );
    expect(addr).toBe(FIXTURE_GOLDEN_ESCROW_ADDRESS);
  });
});
