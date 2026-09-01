import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/**
 * Query for `GET /offerings` (TOV-154). Inherits `page`/`limit` (bounded, transformed). `status` is an
 * optional CSV filter validated in the service against `OFFERING_STATUSES`; when omitted it defaults to
 * the non-terminal active set. `artworkId` is an optional exact filter.
 */
export class OfferingListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'CSV of offering statuses, e.g. "planned,approved"', example: 'planned' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  artworkId?: string;
}
