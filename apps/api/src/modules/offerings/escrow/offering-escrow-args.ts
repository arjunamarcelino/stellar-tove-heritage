import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { OfferingConstructorArgs } from './offering-escrow.service.interface';

/**
 * The ONE place the OfferingEscrow constructor's positional order lives (Enhancement #13). Encode the
 * 8 args as a positional `ScVal[]` in EXACT ABI order:
 *   usdc, total_supply, artist, artist_retention, treasury, treasury_retention, artist_payout, admin.
 *
 * Every value carries an explicit `{ type }` hint: without it a bare `bigint` infers `u64`/`u128` and a
 * bare address-string infers `scvString`, both of which the host rejects. Three same-typed Address args
 * (artist / treasury / artist_payout) mean only an index-by-index golden-vector catches a swap — the
 * unit test asserts positionally.
 */
const ADDRESS = { type: 'address' } as const;
const I128 = { type: 'i128' } as const;

export function encodeConstructorArgs(a: OfferingConstructorArgs): xdr.ScVal[] {
  return [
    nativeToScVal(a.usdc, ADDRESS),
    nativeToScVal(a.totalSupply, I128),
    nativeToScVal(a.artist, ADDRESS),
    nativeToScVal(a.artistRetention, I128),
    nativeToScVal(a.treasury, ADDRESS),
    nativeToScVal(a.treasuryRetention, I128),
    nativeToScVal(a.artistPayout, ADDRESS),
    nativeToScVal(a.admin, ADDRESS),
  ];
}
