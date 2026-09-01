import { Submission } from '../entities/submission.entity';

export interface ISubmissionRepository {
  findAccepted(userId: string, missionId: string): Promise<Submission | null>;
  findPending(userId: string, missionId: string): Promise<Submission | null>;
  countCompletedMissionsByStageIds(
    userId: string,
    stageIds: string[],
  ): Promise<Map<string, number>>;
}
