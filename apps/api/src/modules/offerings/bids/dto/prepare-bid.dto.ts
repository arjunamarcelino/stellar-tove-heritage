import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { STROOPS_RE } from '@common/constants/stroops.constant';

/**
 * Request to prepare (or submit) a bid: price per fraction (USDC stroops) + fraction count. The pipe
 * rejects only MALFORMED input (→ 400); the band (`low ≤ price ≤ high`), `count ≤ public_float`, window,
 * whitelist, and one-active-bid rules are business checks deferred to the service (→ 409/422/403).
 */
export class PrepareBidDto {
  @ApiProperty({
    description: 'Bid price per fraction in USDC stroops (canonical non-negative integer string)',
    example: '100000000',
  })
  @IsString()
  @MaxLength(39) // bounds abuse; the low ≤ price ≤ high band is enforced in the service (clean 422)
  @Matches(STROOPS_RE, { message: 'price must be a canonical stroops integer' })
  price!: string;

  @ApiProperty({ description: 'Number of fractions to bid for', example: 10 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER) // the real ceiling is public_float (a per-offering 422); this bounds abuse
  count!: number;
}
