import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsStellarPublicKey } from '@common/validators/is-stellar-public-key.validator';

/** Trim a string value; pass non-strings through untouched (let the type validator reject them). */
const trimOrValue = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Lower-case + trim (email only — G-addresses are case-sensitive and must NOT be normalized). */
const lowerTrimOrValue = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

/**
 * Reject C0 control chars + DEL + C1 controls + Unicode line/paragraph separators, but allow tab (0x09) /
 * LF (0x0A) / CR (0x0D) — legit in multi-line notes. Built from char codes so no control byte appears in
 * this source file (a literal regex is equally source-clean but this build keeps the ranges explicit/typo-safe).
 * Free-text hygiene only — the real XSS/template-injection defense is OUTPUT-ENCODING by every downstream
 * consumer (see the FE contract).
 */
const FORBIDDEN_CONTROL_CHARS = [
  ...Array.from({ length: 0x20 }, (_, i) => i).filter((c) => c !== 0x09 && c !== 0x0a && c !== 0x0d), // C0 minus tab/LF/CR
  0x7f, // DEL
  ...Array.from({ length: 0x20 }, (_, i) => 0x80 + i), // C1 controls 0x80–0x9F
  0x2028,
  0x2029, // line / paragraph separators
]
  .map((c) => String.fromCharCode(c))
  .join('');
const NO_CONTROL_CHARS = new RegExp(`^[^${FORBIDDEN_CONTROL_CHARS}]*$`);

/**
 * Body for `POST /me/beneficiary`. Full-replace (PUT) semantics: an omitted optional is cleared to `null`
 * in the service (the DTO leaves it `undefined`). All validation is structural → the global ValidationPipe
 * emits a uniform 400; there are no domain error codes.
 */
export class SetBeneficiaryDto {
  @ApiProperty({ maxLength: 200, example: 'Jane Doe' })
  @Transform(trimOrValue)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(NO_CONTROL_CHARS, { message: 'name must not contain control characters' })
  name!: string;

  @ApiProperty({ maxLength: 320, format: 'email', example: 'jane@example.com' })
  @Transform(lowerTrimOrValue)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({
    example: 'GA6QN2DQC5NSIJLA7BD4E247CD5OG4MTHQHDZQIGDQEGGE2OKML54IHS',
    description: 'Beneficiary Stellar G-address',
  })
  @IsOptional()
  @IsStellarPublicKey()
  stellarPubkey?: string;

  @ApiPropertyOptional({ maxLength: 64, example: 'spouse' })
  @IsOptional()
  @Transform(trimOrValue)
  @IsString()
  @MaxLength(64)
  @Matches(NO_CONTROL_CHARS, { message: 'relationship must not contain control characters' })
  relationship?: string;

  @ApiPropertyOptional({ maxLength: 1000, example: 'Primary heir; contact via the family solicitor.' })
  @IsOptional()
  @Transform(trimOrValue)
  @IsString()
  @MaxLength(1000)
  @Matches(NO_CONTROL_CHARS, { message: 'notes must not contain control characters' })
  notes?: string;
}
