import { IsArray, IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import {
  ARTWORK_STATUSES,
  ArtworkStatus,
} from '@modules/fractionalization/constants/artwork-status.constant';

/**
 * Query params for the admin artwork list (TOV-240). Extends the shared pagination DTO with an optional
 * CSV `status` filter validated against the canonical enum. An out-of-enum value → 400 (ValidationPipe);
 * an empty/whitespace-only CSV → `[]` → the service applies the default filter (see service).
 */
export class ArtworkQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'CSV of lifecycle statuses to filter by (defaults to the fractionalization-relevant states)',
    example: 'verified,fractionalized',
    enum: ARTWORK_STATUSES,
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    const v: unknown = value;
    return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v;
  })
  @IsArray()
  @IsIn([...ARTWORK_STATUSES], { each: true })
  status?: ArtworkStatus[];
}
