import { ApiProperty } from '@nestjs/swagger';
import { MissionStatsRow } from '../../missions/repositories/mission-repository.interface';

export class DashboardMissionStatsResponseDto {
  @ApiProperty({ example: 'f1a2b3c4-d5e6-7890-abcd-ef0123456789' })
  missionId!: string;

  @ApiProperty({ example: 'Follow @tove on Instagram' })
  missionTitle!: string;

  @ApiProperty({ example: 'Stage 1: Social' })
  stageTitle!: string;

  @ApiProperty({
    example: 45,
    description: 'Unique users who submitted to this mission',
  })
  totalUsers!: number;

  @ApiProperty({
    example: 12,
    description:
      'Unique users with a pending submission. A user with multiple statuses is counted in each.',
  })
  pending!: number;

  @ApiProperty({
    example: 30,
    description:
      'Unique users with an accepted submission. A user with multiple statuses is counted in each.',
  })
  accepted!: number;

  @ApiProperty({
    example: 3,
    description:
      'Unique users with a rejected submission. A user with multiple statuses is counted in each.',
  })
  rejected!: number;

  static fromRaw(row: MissionStatsRow): DashboardMissionStatsResponseDto {
    const dto = new DashboardMissionStatsResponseDto();
    dto.missionId = row.missionId;
    dto.missionTitle = row.missionTitle;
    dto.stageTitle = row.stageTitle;
    dto.totalUsers = parseInt(row.totalUsers, 10);
    dto.pending = parseInt(row.pending, 10);
    dto.accepted = parseInt(row.accepted, 10);
    dto.rejected = parseInt(row.rejected, 10);
    return dto;
  }
}
