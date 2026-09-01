import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { STROOPS_RE } from '@common/constants/stroops.constant';
import { TZ_OFFSET_RE } from '@common/constants/iso-timestamp.constant';

/**
 * Body for `POST /api/v1/marketplace/rfqs/:id/quotes` (TOV-175, FR-06.03). A whitelisted holder offers to
 * SELL fractions on an open RFQ. The pipe layer (this DTO) rejects only MALFORMED input (→ 400); business
 * rules (whitelist / RFQ state / free-balance / validity) are the service's (→ 403/404/422/503).
 *
 * Money is a canonical integer STRING (`STROOPS_RE`), never a JSON number, for BigInt precision + a stable
 * idempotency fingerprint. `@MaxLength(39)` bounds `BigInt()` parse cost and aligns with `numeric(39,0)`;
 * `"0"` and values > 2^96-1 pass the pipe but are rejected by the service's price bound (422). `fractionCount`
 * is capped at `MAX_SAFE_INTEGER` (mirrors `CreateRfqDto`; the free-balance gate is the effective ceiling).
 * `validUntil` MUST carry an explicit tz offset — `@IsISO8601` alone does not enforce it (see `TZ_OFFSET_RE`).
 */
export class CreateQuoteDto {
  @ApiProperty({
    description: 'Ask price per fraction in USDC stroops (canonical integer string, 1..2^96-1)',
    example: '150000000',
  })
  @IsString()
  @MaxLength(39)
  @Matches(STROOPS_RE, { message: 'pricePerFractionStroops must be a canonical stroops integer' })
  pricePerFractionStroops!: string;

  @ApiProperty({ description: 'Number of fractions the holder offers to sell', example: 25, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  fractionCount!: number;

  @ApiProperty({
    description: 'Quote validity deadline (ISO-8601 with explicit tz offset); silently capped to the RFQ expiry',
    example: '2026-08-25T12:00:00Z',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TZ_OFFSET_RE, { message: 'validUntil must include an explicit timezone offset (Z or ±hh:mm)' })
  validUntil!: string;
}
