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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { BackofficeRequest } from '@common/interfaces/backoffice-request.interface';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ApiPaginatedResponse } from '@common/decorators/api-paginated-response.decorator';
import { StagesService } from './stages.service';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { StageResponseDto } from './dto/stage-response.dto';

@ApiTags('Backoffice Stages')
@Controller('stages')
@ApiBearerAuth()
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.SUPERADMIN)
export class StagesController {
  constructor(private readonly stagesService: StagesService) {}

  @Get()
  @ApiOperation({ summary: 'List all stages (paginated)' })
  @ApiPaginatedResponse(StageResponseDto)
  findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<StageResponseDto>> {
    return this.stagesService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get stage by ID' })
  @ApiOkResponse({ type: StageResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<StageResponseDto> {
    return this.stagesService.findOneById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new stage' })
  @ApiCreatedResponse({ type: StageResponseDto })
  create(
    @Body() dto: CreateStageDto,
    @Request() req: BackofficeRequest,
  ): Promise<StageResponseDto> {
    return this.stagesService.create(dto, req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a stage' })
  @ApiOkResponse({ type: StageResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStageDto,
    @Request() req: BackofficeRequest,
  ): Promise<StageResponseDto> {
    return this.stagesService.update(id, dto, req.user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a stage' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.stagesService.softDelete(id);
  }
}
