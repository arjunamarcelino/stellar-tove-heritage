import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { SubmissionStatus } from '@common/enums/submission-status.enum';
import { Submission } from '../entities/submission.entity';
import { ISubmissionRepository } from './submission-repository.interface';

@Injectable()
export class SubmissionRepository
  extends BaseRepository<Submission>
  implements ISubmissionRepository
{
  constructor(dataSource: DataSource) {
    super(Submission, dataSource);
  }

  async findAccepted(userId: string, missionId: string): Promise<Submission | null> {
    return this.repository.findOne({
      where: { userId, missionId, status: SubmissionStatus.ACCEPTED },
    });
  }

  async findPending(userId: string, missionId: string): Promise<Submission | null> {
    return this.repository.findOne({
      where: { userId, missionId, status: SubmissionStatus.PENDING },
    });
  }

  async countCompletedMissionsByStageIds(
    userId: string,
    stageIds: string[],
  ): Promise<Map<string, number>> {
    if (stageIds.length === 0) return new Map();

    const results = await this.repository
      .createQueryBuilder('s')
      .select('m.stage_id', 'stageId')
      .addSelect('COUNT(DISTINCT s.mission_id)', 'count')
      .innerJoin('missions', 'm', 'm.id = s.mission_id')
      .where('s.user_id = :userId', { userId })
      .andWhere('s.status = :status', { status: SubmissionStatus.ACCEPTED })
      .andWhere('m.stage_id IN (:...stageIds)', { stageIds })
      .andWhere('s.deleted_at IS NULL')
      .andWhere('m.deleted_at IS NULL')
      .andWhere('m.is_active = true')
      .groupBy('m.stage_id')
      .getRawMany<{ stageId: string; count: string }>();

    return new Map(results.map((r) => [r.stageId, parseInt(r.count, 10)]));
  }
}
