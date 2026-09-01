import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { computePublicFloat } from '@modules/fractionalization/fraction-contract.helpers';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { MAX_STROOPS } from '@common/constants/stroops.constant';

/**
 * Shared offering-planning primitives (TOV-152 write + TOV-153 preview). Extracting these here is the
 * parity anchor: the live preview validates and computes with the EXACT same logic the POST snapshots,
 * so a preview that shows "valid" can never fail on submit.
 */

/**
 * Price-band rule (→ 422 `OFFERING_BAND_INVALID`): `0 < low < high <= 2^96−1`. The `<= MAX_STROOPS`
 * bound is load-bearing — without it an oversized (regex-valid) price passes the service, then violates
 * `CHK_off_band` at save() and (since the txn catch only maps the unique-index violation) surfaces as an
 * uncaught 500. Returns the parsed bigints so callers (preview) can reuse them for the raise range.
 */
export function assertBandValid(lowStr: string, highStr: string): { low: bigint; high: bigint } {
  const low = BigInt(lowStr);
  const high = BigInt(highStr);
  if (low <= 0n || high <= 0n || low >= high || high > MAX_STROOPS) {
    throw failHttp(
      ErrorCode.OFFERING_BAND_INVALID,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Invalid price band (require 0 < low < high <= 2^96-1)',
    );
  }
  return { low, high };
}

/**
 * Resolve the deployed fraction contract that sources the public float (→ 409 / 422). The `!= null`
 * retention guard is load-bearing — `BigInt(null)` throws. Returns the already-narrowed retention
 * strings (non-null, proven here) so callers need no `!` assertions.
 */
export function resolveOfferableFloat(fc: FractionContract | null): {
  contract: FractionContract;
  publicFloat: bigint;
  totalSupply: string;
  artistRetentionAmount: string;
  treasuryRetentionAmount: string;
} {
  if (
    !fc ||
    fc.status !== 'deployed' ||
    fc.artistRetentionAmount == null ||
    fc.treasuryRetentionAmount == null
  ) {
    throw failHttp(
      ErrorCode.OFFERING_ARTWORK_NOT_FRACTIONALIZED,
      HttpStatus.CONFLICT,
      'Artwork has no deployed fraction contract',
    );
  }
  // `<= 0` (not `== 0`): a negative float would be source corruption.
  const publicFloat = computePublicFloat(fc);
  if (publicFloat <= 0n) {
    throw failHttp(
      ErrorCode.OFFERING_NO_FLOAT,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Retentions consume the whole supply — no public float to offer',
    );
  }
  return {
    contract: fc,
    publicFloat,
    // The three planning-snapshot inputs (TOV-165) all flow from this one narrowed source so the caller
    // freezes them onto the offering symmetrically (total_supply is already non-null, but returned here for
    // parity with the retention fields).
    totalSupply: fc.totalSupply,
    artistRetentionAmount: fc.artistRetentionAmount,
    treasuryRetentionAmount: fc.treasuryRetentionAmount,
  };
}
