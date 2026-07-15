import { Controller, Get, Param, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { ApiCollectionResponse } from '@common/decorators/api-collection-response.decorator';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';
import { ArtworksService } from './artworks.service';
import { ArtworkResponseDto } from './dto/artwork-response.dto';

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
  @ApiOperation({ summary: 'Get an artwork by id' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: ArtworkResponseDto })
  findOneById(@Param('id') id: string): Promise<ArtworkResponseDto> {
    return this.service.findOneById(id);
  }
}
