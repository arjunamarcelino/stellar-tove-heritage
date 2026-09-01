import { describe, it, expect } from 'vitest';
import { Address, scValToNative } from '@stellar/stellar-sdk';
import { encodeConstructorArgs } from '../../../../src/modules/offerings/escrow/offering-escrow-args';
import {
  FIXTURE_CONSTRUCTOR_ARGS,
  OFFERING_ESCROW_USDC_ADDRESS,
  FIXTURE_ARTIST_ADDRESS,
  FIXTURE_ADMIN_PUBLIC_KEY,
} from '../../../shared/fixtures/offering-escrow.fixtures';

/**
 * Golden-vector guard on the OfferingEscrow constructor encoding. The suites otherwise run against a
 * fake escrow service, so this index-by-index positional assertion is the ONLY CI check that catches a
 * reorder — and 3 same-typed Address args (artist / treasury / artistPayout) mean ONLY positional order
 * catches a swap. Also guards against an amount regressing away from i128 (bare bigint → u64/u128 host
 * reject) or an address regressing to scvString.
 */
describe('encodeConstructorArgs (golden vector — OfferingEscrow constructor ABI)', () => {
  const args = encodeConstructorArgs(FIXTURE_CONSTRUCTOR_ARGS);

  it('encodes exactly 8 positional args', () => {
    expect(args).toHaveLength(8);
  });

  it('asserts the ABI type at EVERY index (swap-catcher for the 3 Address args)', () => {
    // usdc, total_supply, artist, artist_retention, treasury, treasury_retention, artist_payout, admin
    const expected = [
      'scvAddress',
      'scvI128',
      'scvAddress',
      'scvI128',
      'scvAddress',
      'scvI128',
      'scvAddress',
      'scvAddress',
    ];
    expect(args.map((v) => v.switch().name)).toEqual(expected);
  });

  it('round-trips the i128 amounts back to the input bigints', () => {
    expect(scValToNative(args[1])).toBe(FIXTURE_CONSTRUCTOR_ARGS.totalSupply);
    expect(scValToNative(args[3])).toBe(FIXTURE_CONSTRUCTOR_ARGS.artistRetention);
    expect(scValToNative(args[5])).toBe(FIXTURE_CONSTRUCTOR_ARGS.treasuryRetention);
  });

  it('decodes each address arg back to its exact input StrKey (positionally)', () => {
    expect(Address.fromScVal(args[0]).toString()).toBe(OFFERING_ESCROW_USDC_ADDRESS);
    expect(Address.fromScVal(args[2]).toString()).toBe(FIXTURE_ARTIST_ADDRESS);
    expect(Address.fromScVal(args[4]).toString()).toBe(OFFERING_ESCROW_USDC_ADDRESS);
    expect(Address.fromScVal(args[6]).toString()).toBe(FIXTURE_ARTIST_ADDRESS);
    expect(Address.fromScVal(args[7]).toString()).toBe(FIXTURE_ADMIN_PUBLIC_KEY);
  });
});
