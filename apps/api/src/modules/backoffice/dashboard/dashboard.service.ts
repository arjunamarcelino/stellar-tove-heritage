import { Injectable, Inject } from '@nestjs/common';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { Mission } from '../missions/entities/mission.entity';
import { IMissionRepository } from '../missions/repositories/mission-repository.interface';
import { UsersService } from '@modules/users/users.service';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary-response.dto';
import { DashboardMissionStatsResponseDto } from './dto/dashboard-mission-stats-response.dto';

@Injectable()
export class DashboardService {
  constructor(
    private readonly usersService: UsersService,
    @Inject('IMissionRepository')
    private readonly missionRepository: IBaseRepository<Mission> & IMissionRepository,
  ) {}

  async getSummary(): Promise<DashboardSummaryResponseDto> {
    const [totalUsers, [totalMissions, activeMissions]] = await Promise.all([
      this.usersService.count(),
      this.missionRepository.countMissionSummary(),
    ]);

    const dto = new DashboardSummaryResponseDto();
    dto.totalUsers = totalUsers;
    dto.totalMissions = totalMissions;
    dto.activeMissions = activeMissions;
    return dto;
  }

  async getMissionStats(): Promise<DashboardMissionStatsResponseDto[]> {
    const rows = await this.missionRepository.getMissionSubmissionStats();
    return rows.map((row) => DashboardMissionStatsResponseDto.fromRaw(row));
  }
}
