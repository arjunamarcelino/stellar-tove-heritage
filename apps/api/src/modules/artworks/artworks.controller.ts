import { Controller, Get, Param, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { ApiCollectionResponse } from '@common/decorators/api-collection-response.decorator';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';
import { ArtworksService } from './artworks.service';
import { ArtworkResponseDto } from './dto/artwork-response.dto';
import { ArtworkDetailResponseDto } from './dto/artwork-detail-response.dto';

@ApiTags('Artworks')
@Public()
@Controller('artworks')
export class ArtworksController {
  constructor(private readonly service: ArtworksService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'List public artworks' })
  @ApiCollectionResponse(ArtworkResponseDto)
  list(): Promise<CollectionResponseDto<ArtworkResponseDto>> {
    return this.service.list();
  }

  @Get(':id')
  // The detail body carries 1h signed capability URLs (images + COA) — must NOT be shared-cached.
  @Header('Cache-Control', 'no-store')
  // Dedicated tighter limit: each detail hit fans out to up to ~21 Supabase signing calls.
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: 'Get an artwork detail by id' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: ArtworkDetailResponseDto })
  findOneById(@Param('id') id: string): Promise<ArtworkDetailResponseDto> {
    return this.service.findOneById(id);
  }
}
