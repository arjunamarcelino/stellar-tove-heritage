import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { TimelineService } from './timeline.service';
import { TimelineQueryDto } from './dto/timeline-query.dto';
import { TimelineResponseDto } from './dto/timeline-response.dto';

/**
 * Public anonymous artwork provenance timeline (TOV-191). Shares the `artworks` base path with
 * `ArtworksController` (different module, disjoint method paths — RouterModule prefixes by declaring module,
 * so both resolve under `api/v1/artworks`, no collision). `no-store`: the body mutates on admin publish +
 * new events and varies by `expand`/`cursor`/`limit`.
 */
@ApiTags('Artworks')
@Public()
@Controller('artworks')
export class TimelineController {
  constructor(private readonly service: TimelineService) {}

  @Get(':id/timeline')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Get an artwork provenance timeline (cursor-paginated, visibility-tiered)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: TimelineResponseDto })
  getTimeline(
    @Param('id') id: string,
    @Query() query: TimelineQueryDto,
  ): Promise<TimelineResponseDto> {
    return this.service.getTimeline(id, query);
  }
}
