import { ApiProperty } from '@nestjs/swagger';

export class DashboardSummaryResponseDto {
  @ApiProperty({ example: 150 })
  totalUsers!: number;

  @ApiProperty({ example: 24 })
  totalMissions!: number;

  @ApiProperty({ example: 18 })
  activeMissions!: number;
}
