import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { STROOPS_RE } from '@common/constants/stroops.constant';
import { MAX_EXPIRY_HOURS, MIN_EXPIRY_HOURS } from '../constants/rfq.constant';

/**
 * Create an RFQ on a fractionalized artwork (TOV-172, FR-06.01). Fields are camelCase to match every other
 * authenticated `api/v1` surface (offering bids, me/holdings). The pipe layer rejects only MALFORMED input
 * (→ 400); business rules (price/overflow bounds, whitelist, fractionalized, active-open ceiling) live in the
 * service (→ 403/422). `maxPricePerFractionStroops` is a canonical stroops STRING (never a JSON number) so
 * big-integer precision is preserved and the idempotency fingerprint stays stable — mirrors `SubmitBidDto`.
 */
export class CreateRfqDto {
  @ApiProperty({ description: 'The fractionalized artwork to request a quote on', format: 'uuid' })
  @IsUUID()
  artworkId!: string;

  @ApiProperty({ description: 'Number of fractions the collector wants to buy', example: 100, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  fractionCount!: number;

  @ApiProperty({
    description: 'Max price per fraction in USDC stroops (canonical integer string, 1..2^96-1)',
    example: '150000000',
  })
  @IsString()
  @MaxLength(39)
  @Matches(STROOPS_RE, { message: 'maxPricePerFractionStroops must be a canonical stroops integer' })
  maxPricePerFractionStroops!: string;

  @ApiPropertyOptional({
    description: 'RFQ lifetime in hours (1..168). Omit to default to 48h.',
    minimum: MIN_EXPIRY_HOURS,
    maximum: MAX_EXPIRY_HOURS,
    example: 72,
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_EXPIRY_HOURS)
  @Max(MAX_EXPIRY_HOURS)
  expiryHours?: number;
}
