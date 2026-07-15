import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { SubmissionsService } from './submissions.service';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { SubmissionResponseDto } from './dto/submission-response.dto';
import { SubmissionQueryDto } from './dto/submission-query.dto';

@ApiTags('Submissions')
@ApiBearerAuth()
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('missions/:missionId/submit')
  @ApiOperation({ summary: 'Submit evidence for a mission' })
  @ApiCreatedResponse({ type: SubmissionResponseDto })
  submit(
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: SubmitEvidenceDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<SubmissionResponseDto> {
    return this.submissionsService.submit(user.sub, missionId, dto);
  }

  @Get('submissions')
  @ApiOperation({ summary: 'List own submissions' })
  @ApiOkResponse({ type: SubmissionResponseDto, isArray: true })
  findAll(
    @Query() query: SubmissionQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PaginatedResponseDto<SubmissionResponseDto>> {
    return this.submissionsService.findAllByUser(user.sub, query.page, query.limit, query.status);
  }
}
