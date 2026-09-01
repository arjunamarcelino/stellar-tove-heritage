import { FractionContract } from './entities/fraction-contract.entity';

/** Floatable supply = total_supply − artist_retention − treasury_retention (i128).
 *  Caller guarantees a DEPLOYED contract with non-null retention amounts. */
export function computePublicFloat(fc: FractionContract): bigint {
  return (
    BigInt(fc.totalSupply) -
    BigInt(fc.artistRetentionAmount!) -
    BigInt(fc.treasuryRetentionAmount!)
  );
}
