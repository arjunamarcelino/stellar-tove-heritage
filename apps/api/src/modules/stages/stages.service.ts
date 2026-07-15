import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { ErrorCode } from '@common/enums/error-code.enum';
import { Stage } from '../backoffice/stages/entities/stage.entity';
import { IStageRepository } from '../backoffice/stages/repositories/stage-repository.interface';
import { Mission } from '../backoffice/missions/entities/mission.entity';
import { IMissionRepository } from '../backoffice/missions/repositories/mission-repository.interface';
import { ISubmissionRepository } from '../submissions/repositories/submission-repository.interface';
import { Submission } from '../submissions/entities/submission.entity';
import { StageProgressDto } from './dto/stage-progress.dto';
import { MissionSummaryDto } from './dto/mission-summary.dto';
import { StageDetailResponseDto } from './dto/stage-detail-response.dto';

@Injectable()
export class UserStagesService {
  constructor(
    @Inject('IStageRepository')
    private readonly stageRepository: IBaseRepository<Stage> & IStageRepository,
    @Inject('IMissionRepository')
    private readonly missionRepository: IBaseRepository<Mission> & IMissionRepository,
    @Inject('ISubmissionRepository')
    private readonly submissionRepository: IBaseRepository<Submission> & ISubmissionRepository,
  ) {}

  async getUserProgress(userId: string): Promise<StageProgressDto[]> {
    const stages = await this.stageRepository.findAll({ order: { order: 'ASC' } });
    const stageIds = stages.map((s) => s.id);
    if (stageIds.length === 0) return [];

    const [missionCounts, completedCounts] = await Promise.all([
      this.missionRepository.countActiveMissionsByStageIds(stageIds),
      this.submissionRepository.countCompletedMissionsByStageIds(userId, stageIds),
    ]);

    return stages.map((stage) => {
      const total = missionCounts.get(stage.id) ?? 0;
      const completed = completedCounts.get(stage.id) ?? 0;
      return StageProgressDto.create({ stage, totalMissions: total, completedMissions: completed });
    });
  }

  async getCurrentStage(userId: string): Promise<StageProgressDto | null> {
    const progress = await this.getUserProgress(userId);
    const active = progress.filter((s) => s.isEffectivelyActive);
    return active.find((s) => !s.isCompleted) ?? active.at(-1) ?? null;
  }

  async getStageDetail(
    userId: string,
    stageId: string,
  ): Promise<StageDetailResponseDto> {
    const stage = await this.stageRepository.findOneById(stageId);
    if (!stage) {
      throw new NotFoundException(ErrorCode.STAGE_NOT_FOUND);
    }

    const allMissions = await this.missionRepository.findByStageId(stageId);
    const activeMissions = allMissions.filter((m) => m.isActive);

    const stageIds = [stageId];
    const [missionCounts, completedCounts] = await Promise.all([
      this.missionRepository.countActiveMissionsByStageIds(stageIds),
      this.submissionRepository.countCompletedMissionsByStageIds(userId, stageIds),
    ]);

    const total = missionCounts.get(stageId) ?? 0;
    const completed = completedCounts.get(stageId) ?? 0;

    const response = new StageDetailResponseDto();
    response.stage = StageProgressDto.create({
      stage,
      totalMissions: total,
      completedMissions: completed,
    });
    response.missions = activeMissions.map((m) => MissionSummaryDto.fromEntity(m));
    return response;
  }

}
