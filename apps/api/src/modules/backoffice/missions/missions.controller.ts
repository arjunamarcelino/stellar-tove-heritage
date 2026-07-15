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
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { MissionsService } from './missions.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';
import { MissionQueryDto } from './dto/mission-query.dto';
import { MissionResponseDto } from './dto/mission-response.dto';

@ApiTags('Backoffice Missions')
@Controller('missions')
@ApiBearerAuth()
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.SUPERADMIN)
export class MissionsController {
  constructor(private readonly missionsService: MissionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all missions (paginated, filterable by stage)' })
  @ApiOkResponse({ type: MissionResponseDto, isArray: true })
  findAll(
    @Query() query: MissionQueryDto,
  ): Promise<PaginatedResponseDto<MissionResponseDto>> {
    return this.missionsService.findAll(query.page, query.limit, query.stageId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get mission by ID' })
  @ApiOkResponse({ type: MissionResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<MissionResponseDto> {
    return this.missionsService.findOneById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new mission' })
  @ApiCreatedResponse({ type: MissionResponseDto })
  create(
    @Body() dto: CreateMissionDto,
    @Request() req: BackofficeRequest,
  ): Promise<MissionResponseDto> {
    return this.missionsService.create(dto, req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a mission' })
  @ApiOkResponse({ type: MissionResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMissionDto,
    @Request() req: BackofficeRequest,
  ): Promise<MissionResponseDto> {
    return this.missionsService.update(id, dto, req.user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a mission' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.missionsService.softDelete(id);
  }
}
