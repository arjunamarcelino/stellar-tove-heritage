import { Controller, Get, Param, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { ApiCollectionResponse } from '@common/decorators/api-collection-response.decorator';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';
import { ArtistsService } from './artists.service';
import { ArtistResponseDto } from './dto/artist-response.dto';

@ApiTags('Artists')
@Public()
@Controller('artists')
export class ArtistsController {
  constructor(private readonly service: ArtistsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'List public artists' })
  @ApiCollectionResponse(ArtistResponseDto)
  list(): Promise<CollectionResponseDto<ArtistResponseDto>> {
    return this.service.list();
  }

  @Get(':handle')
  @ApiOperation({ summary: 'Get a public artist by handle' })
  @ApiParam({ name: 'handle' })
  @ApiOkResponse({ type: ArtistResponseDto })
  findByHandle(@Param('handle') handle: string): Promise<ArtistResponseDto> {
    return this.service.findByHandle(handle);
  }
}
