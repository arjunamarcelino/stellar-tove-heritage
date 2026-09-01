import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
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
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ApiPaginatedResponse } from '@common/decorators/api-paginated-response.decorator';
import { AdminsService } from './admins.service';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AdminResponseDto } from './dto/admin-response.dto';

@ApiTags('Backoffice Admins')
@Controller('admins')
@ApiBearerAuth()
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.SUPERADMIN)
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get()
  @ApiOperation({ summary: 'List all admins (paginated)' })
  @ApiPaginatedResponse(AdminResponseDto)
  findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<AdminResponseDto>> {
    return this.adminsService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get admin by ID' })
  @ApiOkResponse({ type: AdminResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AdminResponseDto> {
    return this.adminsService.findOneById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update admin' })
  @ApiOkResponse({ type: AdminResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDto,
  ): Promise<AdminResponseDto> {
    return this.adminsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete admin' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.adminsService.softDelete(id);
  }
}
