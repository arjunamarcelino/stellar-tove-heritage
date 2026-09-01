import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';

/**
 * Live offering-planning preview (TOV-153). camelCase; every money value is a string (`numeric(39,0)`
 * / i128 — never a JS `number`). `publicFloat` here is the LIVE value (what the next `POST /offerings`
 * would snapshot). `estimatedRaise*` is BigInt-multiply → decimal string, display-only and unpersisted;
 * it may exceed `numeric(39,0)` and must never be `Number()`-coerced.
 */
export class OfferingPreviewDto {
  @ApiProperty({
    type: 'string',
    example: '900000',
    description: 'totalSupply − artistRetentionAmount − treasuryRetentionAmount (fraction base-units)',
  })
  publicFloat!: string;

  @ApiProperty({ type: 'string', example: '1000000' })
  totalSupply!: string;

  @ApiProperty({ type: 'string', example: '80000' })
  artistRetentionAmount!: string;

  @ApiProperty({ type: 'string', example: '20000' })
  treasuryRetentionAmount!: string;

  @ApiPropertyOptional({ type: 'string', example: '50000000', description: 'Echoed band (present only when supplied)' })
  lowPriceStroops?: string;

  @ApiPropertyOptional({ type: 'string', example: '150000000' })
  highPriceStroops?: string;

  @ApiPropertyOptional({
    type: 'string',
    example: '45000000000000',
    description: 'low × publicFloat — total USDC stroops (display-only, unpersisted)',
  })
  estimatedRaiseLow?: string;

  @ApiPropertyOptional({ type: 'string', example: '135000000000000', description: 'high × publicFloat — total USDC stroops' })
  estimatedRaiseHigh?: string;

  /** Consumes the narrowed result of `resolveOfferableFloat` → no `!` assertions. */
  static build(
    r: {
      contract: FractionContract;
      publicFloat: bigint;
      artistRetentionAmount: string;
      treasuryRetentionAmount: string;
    },
    band?: { low: bigint; high: bigint },
  ): OfferingPreviewDto {
    const dto = new OfferingPreviewDto();
    dto.publicFloat = String(r.publicFloat);
    dto.totalSupply = r.contract.totalSupply;
    dto.artistRetentionAmount = r.artistRetentionAmount;
    dto.treasuryRetentionAmount = r.treasuryRetentionAmount;
    if (band) {
      dto.lowPriceStroops = String(band.low);
      dto.highPriceStroops = String(band.high);
      dto.estimatedRaiseLow = String(band.low * r.publicFloat); // BigInt → decimal string, no Number()
      dto.estimatedRaiseHigh = String(band.high * r.publicFloat);
    }
    return dto;
  }
}
