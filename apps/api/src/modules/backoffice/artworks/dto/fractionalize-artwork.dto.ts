import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Retention percentages (artist + treasury) may not exceed 100 — the rest is the public float. */
@ValidatorConstraint({ name: 'retentionSum', async: false })
export class RetentionSumConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args?: ValidationArguments): boolean {
    const o = args?.object as FractionalizeArtworkDto | undefined;
    return (o?.artist_retention_pct ?? 0) + (o?.treasury_retention_pct ?? 0) <= 100;
  }
  defaultMessage(): string {
    return 'artist_retention_pct + treasury_retention_pct must be <= 100';
  }
}

/**
 * Body for `POST /admin/artworks/:id/fractionalize` (TOV-233). `total_supply` is recorded off-chain and
 * used to derive absolute i128 retention amounts; percentages/lockup-days are converted to the contract's
 * absolute amounts / u64 timestamps at deploy time. `name`/`symbol` become SEP-41 metadata, so `name` is
 * restricted to a printable allowlist (no control/zero-width/RTL) to prevent a wallet-rendered spoof.
 */
export class FractionalizeArtworkDto {
  @ApiProperty({ example: 1000000, minimum: 1, description: 'Total token supply (whole units, decimals=0)' })
  @IsInt()
  @Min(1)
  total_supply!: number;

  @ApiProperty({ example: 10, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  @Validate(RetentionSumConstraint)
  artist_retention_pct!: number;

  @ApiProperty({ example: 5, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  treasury_retention_pct!: number;

  @ApiProperty({ example: 365, minimum: 0 })
  @IsInt()
  @Min(0)
  artist_lockup_days!: number;

  @ApiProperty({ example: 730, minimum: 0 })
  @IsInt()
  @Min(0)
  treasury_lockup_days!: number;

  @ApiProperty({ example: 'Northern Lights Fraction', description: 'SEP-41 token name (printable, 1-32)' })
  @IsString()
  @Matches(/^[\p{L}\p{N} .,'&:-]{1,32}$/u, {
    message: 'name must be 1-32 printable characters (letters, numbers, spaces, . , \' & : -)',
  })
  name!: string;

  @ApiProperty({ example: 'NLIGHT', description: 'SEP-41 token symbol (A-Z0-9, 2-12)' })
  @Matches(/^[A-Z0-9]{2,12}$/, { message: 'symbol must be 2-12 uppercase alphanumerics' })
  symbol!: string;
}
