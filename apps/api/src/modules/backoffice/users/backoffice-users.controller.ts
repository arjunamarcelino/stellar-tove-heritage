import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
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
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ApiPaginatedResponse } from '@common/decorators/api-paginated-response.decorator';
import { UsersService } from '@modules/users/users.service';
import { CreateUserDto } from '@modules/users/dto/create-user.dto';
import { UpdateUserDto } from '@modules/users/dto/update-user.dto';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { ProfileErasureService } from '@modules/users/profile/profile-erasure.service';
import { BeneficiaryErasureService } from '@modules/users/beneficiary/beneficiary-erasure.service';

@ApiTags('Backoffice Users')
@Controller('users')
@ApiBearerAuth()
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.ADMIN, AdminRole.SUPERADMIN)
export class BackofficeUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly profileErasure: ProfileErasureService,
    private readonly beneficiaryErasure: BeneficiaryErasureService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all platform users (paginated)' })
  @ApiPaginatedResponse(UserResponseDto)
  findAll(@Query() query: PaginationQueryDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    return this.usersService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get platform user by ID' })
  @ApiOkResponse({ type: UserResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOneById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new platform user' })
  @ApiCreatedResponse({ type: UserResponseDto })
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update platform user' })
  @ApiOkResponse({ type: UserResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete platform user' })
  @ApiNoContentResponse()
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.usersService.softDelete(id);
    // Right-to-erasure (TOV-30 #414): purge the user's avatar — unpublish public copies now, soft-delete the
    // image rows so the reaper reclaims the private blobs. Best-effort; never blocks the user delete.
    await this.profileErasure.purgeForUser(id);
    // Right-to-erasure (TOV-31 C1): hard-delete the user's beneficiary row (third-party PII). Best-effort.
    await this.beneficiaryErasure.purgeForUser(id);
  }
}
