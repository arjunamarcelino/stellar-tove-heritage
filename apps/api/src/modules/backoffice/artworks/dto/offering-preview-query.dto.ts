import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsDefined, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { STROOPS_RE } from '@common/constants/stroops.constant';

/** Empty-string query param (`?low=`) is treated as ABSENT, so `?low=&high=` = no band (float-only). */
const emptyToUndef = ({ value }: TransformFnParams): unknown =>
  value === '' || value == null ? undefined : value;

/** Both-or-neither: validate a field iff EITHER bound was provided (→ a lone bound fails @IsDefined = 400). */
const eitherPresent = (o: OfferingPreviewQueryDto): boolean =>
  o.low_price_stroops !== undefined || o.high_price_stroops !== undefined;

/**
 * Query for `GET artworks/:id/offering-preview` (TOV-153). snake_case band fields deliberately match the
 * sibling `POST /offerings` request DTO (`low_price_stroops`/`high_price_stroops`) so a single planning UI
 * uses ONE casing for the band across both endpoints. The band is ALL-OR-NOTHING: both bounds present →
 * validate + return the raise range; both absent → float-only; exactly one present → 400. The pattern
 * relies on `@ValidateIf(false)` skipping ALL validators (incl. `@IsDefined`), and on class-transformer
 * running every `@Transform` before any validator, so both fields are normalized empty→undefined before
 * `eitherPresent` reads them. Magnitude (`low < high`) is a business rule enforced in the service (→ 422).
 */
export class OfferingPreviewQueryDto {
  @ApiPropertyOptional({
    example: '50000000',
    description: 'USDC stroops per fraction base-unit; must be paired with high_price_stroops',
  })
  @Transform(emptyToUndef)
  @ValidateIf(eitherPresent)
  @IsDefined({ message: 'low_price_stroops and high_price_stroops must be provided together' })
  @IsString()
  @MaxLength(39)
  @Matches(STROOPS_RE, { message: 'low_price_stroops must be a non-negative integer string' })
  low_price_stroops?: string;

  @ApiPropertyOptional({
    example: '150000000',
    description: 'USDC stroops per fraction base-unit; must be paired with low_price_stroops',
  })
  @Transform(emptyToUndef)
  @ValidateIf(eitherPresent)
  @IsDefined({ message: 'low_price_stroops and high_price_stroops must be provided together' })
  @IsString()
  @MaxLength(39)
  @Matches(STROOPS_RE, { message: 'high_price_stroops must be a non-negative integer string' })
  high_price_stroops?: string;
}
