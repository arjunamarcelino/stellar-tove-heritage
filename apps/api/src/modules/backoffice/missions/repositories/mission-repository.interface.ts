import { Mission } from '../entities/mission.entity';

export interface MissionStatsRow {
  missionId: string;
  missionTitle: string;
  stageTitle: string;
  totalUsers: string;
  pending: string;
  accepted: string;
  rejected: string;
}

export interface IMissionRepository {
  findByStageId(stageId: string): Promise<Mission[]>;
  countActiveMissionsByStageIds(stageIds: string[]): Promise<Map<string, number>>;
  countMissionSummary(): Promise<[total: number, active: number]>;
  getMissionSubmissionStats(): Promise<MissionStatsRow[]>;
}
