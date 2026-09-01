import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { STROOPS_RE } from '@common/constants/stroops.constant';
import { TZ_OFFSET_RE } from '@common/constants/iso-timestamp.constant';

/**
 * Body for `POST /api/backoffice/v1/offerings` (TOV-152, FR-05.01). The pipe layer (this DTO) rejects only MALFORMED
 * input (→ 400): bad uuid, non-integer stroops, non-ISO / offset-less timestamps. Business rules (band /
 * window / float) are deferred to the service (→ 422), exactly as the `fractionalize` sibling separates the
 * two layers.
 *
 * `STROOPS_RE` guarantees the same logical amount always serializes identically, so it can't produce a false
 * idempotency `mismatch`. `@MaxLength(39)` bounds `BigInt()` parse cost and aligns with the `numeric(39,0)`
 * precision. `"0"` passes the pipe but is rejected by the service's `> 0` band rule (422). `TZ_OFFSET_RE`
 * closes the timezone gap: an offset-less string would be parsed as server-local, drifting the persisted
 * instant — an explicit `Z`/`±hh:mm` is mandatory.
 */
export class CreateOfferingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  artwork_id!: string;

  @ApiProperty({ example: '50000000' })
  @IsString()
  @MaxLength(39)
  @Matches(STROOPS_RE, { message: 'low_price_stroops must be a non-negative integer string' })
  low_price_stroops!: string;

  @ApiProperty({ example: '150000000' })
  @IsString()
  @MaxLength(39)
  @Matches(STROOPS_RE, { message: 'high_price_stroops must be a non-negative integer string' })
  high_price_stroops!: string;

  @ApiProperty({ example: '2026-09-01T00:00:00Z' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TZ_OFFSET_RE, { message: 'window_open_at must include an explicit timezone offset (Z or ±hh:mm)' })
  window_open_at!: string;

  @ApiProperty({ example: '2026-09-08T00:00:00Z' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TZ_OFFSET_RE, { message: 'window_close_at must include an explicit timezone offset (Z or ±hh:mm)' })
  window_close_at!: string;
}
