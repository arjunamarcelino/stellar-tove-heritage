import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

export class MissionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by stage ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stageId?: string;
}
