import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

/**
 * Text fields of the multipart KYC submission (the four files are handled by the interceptor, not here).
 * `claimedJurisdiction` is trimmed + upper-cased before validation; a malformed value → 400
 * `VALIDATION_FAILED` (this DTO), while a well-formed but non-allowlisted code → 422
 * `JURISDICTION_NOT_ELIGIBLE` (in the service). The transform is total (passes non-strings through so
 * `@IsString` produces a clean rejection rather than a TypeError).
 */
export class SubmitKycDto {
  @ApiProperty({ example: 'GB', description: 'ISO-3166-1 alpha-2 jurisdiction code' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'claimedJurisdiction must be an ISO-3166-1 alpha-2 code' })
  claimedJurisdiction!: string;
}
