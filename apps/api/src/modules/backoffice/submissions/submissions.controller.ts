import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Request,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { BackofficeRequest } from '@common/interfaces/backoffice-request.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ApiPaginatedResponse } from '@common/decorators/api-paginated-response.decorator';
import { SubmissionResponseDto } from '../../submissions/dto/submission-response.dto';
import { BackofficeSubmissionsService } from './submissions.service';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { SubmissionFilterDto } from './dto/submission-filter.dto';

@ApiTags('Backoffice Submissions')
@Controller('submissions')
@ApiBearerAuth()
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.SUPERADMIN)
export class BackofficeSubmissionsController {
  constructor(private readonly submissionsService: BackofficeSubmissionsService) {}

  @Get()
  @ApiOperation({ summary: 'List submissions (filterable)' })
  @ApiPaginatedResponse(SubmissionResponseDto)
  findAll(
    @Query() query: SubmissionFilterDto,
  ): Promise<PaginatedResponseDto<SubmissionResponseDto>> {
    return this.submissionsService.findAll(query.page, query.limit, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get submission details' })
  @ApiOkResponse({ type: SubmissionResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SubmissionResponseDto> {
    return this.submissionsService.findOneById(id);
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Approve or reject a submission' })
  @ApiOkResponse({ type: SubmissionResponseDto })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewSubmissionDto,
    @Request() req: BackofficeRequest,
  ): Promise<SubmissionResponseDto> {
    return this.submissionsService.review(id, dto, req.user.sub);
  }
}
