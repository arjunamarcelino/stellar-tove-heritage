import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, MaxLength, Min } from 'class-validator';
import { IsBase64Url } from '@common/validators/is-base64url.validator';

/**
 * Strict boolean coercion: `'true'/'false'` → boolean; ANY other value passes through UNCHANGED so
 * `@IsBoolean()` rejects it → 400 (a naive `=== 'true'` would silently map `?expand=1` to false).
 */
function toStrictBoolean({ value }: { value: unknown }): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

/**
 * Query params for `GET /artworks/:id/timeline` (TOV-191). Standalone (NOT extending the offset-based
 * `PaginationQueryDto`, which would leak a dead `page` field). Keyset paging: `cursor` is opaque base64url.
 */
export class TimelineQueryDto {
  @ApiPropertyOptional({ description: 'Reveal expanded-tier (admin/technical) published events', default: false })
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean()
  expand: boolean = false;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque keyset cursor from a previous response' })
  @IsOptional()
  @IsBase64Url()
  @MaxLength(512)
  cursor?: string;
}
