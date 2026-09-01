import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { Offering } from '../entities/offering.entity';
import { OfferingConstructorArgs } from '../escrow/offering-escrow.service.interface';
import { EscrowParamDriftError } from '../escrow/offering-escrow.errors';
import { OfferingEscrowConfig } from '@config/offering-escrow.config';

/**
 * The `string → bigint` + config-address seam for the OfferingEscrow constructor (TOV-154, WS7). This is
 * the ONE place the DB/config values are widened into the typed `OfferingConstructorArgs` bigint boundary;
 * `encodeConstructorArgs` (WS5) owns positional ScVal order. Money-routing addresses that are baked from
 * config (`usdc`, `treasury`, `admin`) come from `cfg`; the artist/payout + supply/retentions come live
 * from the deployed `fraction_contracts` row (which the caller has already drift-checked via
 * `assertPublicFloatMatches` + the `snapshot_artist_address` equality gate in the processor).
 *
 * Retention amounts are nullable on `fraction_contracts` (null until deploy). A null here is a hard,
 * terminal data-integrity fault — NEVER `BigInt(null)` (which coerces to `0n` and would silently deploy a
 * mis-allocated escrow). It surfaces as the terminal `EscrowParamDriftError` so the processor latches
 * `failed` and never retries.
 */

/**
 * The single null-retention guard (todo 291) shared by both `mapConstructorArgs` and
 * `assertPublicFloatMatches` — returns the non-null retention strings so neither re-checks independently.
 */
function requireRetentions(off: Offering, fc: FractionContract): { artist: string; treasury: string } {
  const { artistRetentionAmount, treasuryRetentionAmount } = fc;
  if (artistRetentionAmount === null || treasuryRetentionAmount === null) {
    throw new EscrowParamDriftError(
      `offering ${off.id}: fraction_contracts ${fc.id} has null retention amount(s) — cannot deploy escrow`,
    );
  }
  return { artist: artistRetentionAmount, treasury: treasuryRetentionAmount };
}

export function mapConstructorArgs(
  off: Offering,
  fc: FractionContract,
  cfg: OfferingEscrowConfig,
): OfferingConstructorArgs {
  const { artist: artistRetentionAmount, treasury: treasuryRetentionAmount } = requireRetentions(off, fc);
  return {
    usdc: cfg.usdcAddress,
    totalSupply: BigInt(fc.totalSupply),
    artist: fc.artistAddress,
    artistRetention: BigInt(artistRetentionAmount),
    treasury: cfg.treasuryAddress,
    treasuryRetention: BigInt(treasuryRetentionAmount),
    artistPayout: fc.artistAddress,
    admin: cfg.adminPublicKey,
  };
}

/**
 * The `public_float` belt (plan §"Verified contract ABI", Enhancement #1 / learning #5): the offering's
 * snapshotted `public_float` MUST still equal `total_supply − artist_retention − treasury_retention` from
 * the live `fraction_contracts` row (the escrow's own `allocatable`). A mismatch means the economic
 * params drifted between quorum and deploy → terminal `EscrowParamDriftError` (no deploy, no retry).
 * Null retention amounts are the same hard, terminal fault (never `BigInt(null) → 0n`).
 */
export function assertPublicFloatMatches(off: Offering, fc: FractionContract): void {
  const { artist: artistRetentionAmount, treasury: treasuryRetentionAmount } = requireRetentions(off, fc);
  const expected =
    BigInt(fc.totalSupply) - BigInt(artistRetentionAmount) - BigInt(treasuryRetentionAmount);
  if (BigInt(off.publicFloat) !== expected) {
    throw new EscrowParamDriftError(
      `offering ${off.id}: public_float drift — snapshot=${off.publicFloat} expected=${expected.toString()}`,
    );
  }
}
