import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { UserStagesService } from './stages.service';
import { StageProgressDto } from './dto/stage-progress.dto';
import { StageDetailResponseDto } from './dto/stage-detail-response.dto';

@ApiTags('Stages')
@ApiBearerAuth()
@Controller('stages')
export class UserStagesController {
  constructor(private readonly stagesService: UserStagesService) {}

  @Get()
  @ApiOperation({ summary: 'List all stages with user progress' })
  @ApiOkResponse({ type: StageProgressDto, isArray: true })
  getProgress(@CurrentUser() user: JwtPayload): Promise<StageProgressDto[]> {
    return this.stagesService.getUserProgress(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get stage detail with missions' })
  @ApiOkResponse({ type: StageDetailResponseDto })
  getStageDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<StageDetailResponseDto> {
    return this.stagesService.getStageDetail(user.sub, id);
  }
}
