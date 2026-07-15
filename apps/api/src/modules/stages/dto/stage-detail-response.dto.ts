import { ApiProperty } from '@nestjs/swagger';
import { StageProgressDto } from './stage-progress.dto';
import { MissionSummaryDto } from './mission-summary.dto';

export class StageDetailResponseDto {
  @ApiProperty({ type: StageProgressDto })
  stage!: StageProgressDto;

  @ApiProperty({ type: [MissionSummaryDto] })
  missions!: MissionSummaryDto[];
}
