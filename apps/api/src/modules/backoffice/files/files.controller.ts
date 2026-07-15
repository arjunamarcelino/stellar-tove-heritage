import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { BackofficeRequest } from '@common/interfaces/backoffice-request.interface';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { FilesService } from '@modules/files/files.service';
import { CreateFileDto } from '@modules/files/dto/create-file.dto';
import { UpdateFileDto } from '@modules/files/dto/update-file.dto';
import { FileResponseDto } from '@modules/files/dto/file-response.dto';

const FILE_SIZE_LIMIT = 25 * 1024 * 1024;

@ApiTags('Backoffice Files')
@Controller('files')
@ApiBearerAuth()
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.SUPERADMIN)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  @ApiOperation({ summary: 'List all files (paginated)' })
  @ApiOkResponse({ type: FileResponseDto, isArray: true })
  findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<FileResponseDto>> {
    return this.filesService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get file metadata by ID' })
  @ApiOkResponse({ type: FileResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<FileResponseDto> {
    return this.filesService.findOneById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Upload a PDF file' })
  @ApiCreatedResponse({ type: FileResponseDto })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: FILE_SIZE_LIMIT, files: 1 },
  }))
  create(
    @Body() dto: CreateFileDto,
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: FILE_SIZE_LIMIT })],
    })) file: Express.Multer.File,
    @Request() req: BackofficeRequest,
  ): Promise<FileResponseDto> {
    return this.filesService.create(dto, file, req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update file metadata and/or replace PDF' })
  @ApiOkResponse({ type: FileResponseDto })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: FILE_SIZE_LIMIT, files: 1 },
  }))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFileDto,
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: FILE_SIZE_LIMIT })],
      fileIsRequired: false,
    })) file: Express.Multer.File | undefined,
    @Request() req: BackofficeRequest,
  ): Promise<FileResponseDto> {
    return this.filesService.update(id, dto, file, req.user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a file' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.filesService.softDelete(id);
  }
}
