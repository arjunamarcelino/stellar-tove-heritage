import {
  Controller,
  Get,
  Param,
  Header,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { URL_PATH_REGEX } from './dto/create-file.dto';
import { FileUrlResponseDto } from './dto/file-url-response.dto';
import { FilesService } from './files.service';

@ApiTags('Files')
@Controller('files')
@Public()
export class FilesProxyController {
  constructor(private readonly filesService: FilesService) {}

  @Get(':urlPath')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: 'Get signed URL for a PDF file by URL path' })
  @ApiOkResponse({ type: FileUrlResponseDto })
  @ApiNotFoundResponse({ description: 'File not found or inactive' })
  async serve(@Param('urlPath') urlPath: string): Promise<FileUrlResponseDto> {
    if (urlPath.length > 255 || !URL_PATH_REGEX.test(urlPath)) {
      throw new NotFoundException();
    }

    return this.filesService.getFileUrl(urlPath);
  }
}
