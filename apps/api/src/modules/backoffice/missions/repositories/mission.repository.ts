import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { SubmissionStatus } from '@common/enums/submission-status.enum';
import { Mission } from '../entities/mission.entity';
import { IMissionRepository, MissionStatsRow } from './mission-repository.interface';

@Injectable()
export class MissionRepository extends BaseRepository<Mission> implements IMissionRepository {
  constructor(dataSource: DataSource) {
    super(Mission, dataSource);
  }

  async findByStageId(stageId: string): Promise<Mission[]> {
    return this.repository.find({
      where: { stageId },
      order: { order: 'ASC' },
    });
  }

  async countActiveMissionsByStageIds(stageIds: string[]): Promise<Map<string, number>> {
    if (stageIds.length === 0) return new Map();

    const results = await this.repository
      .createQueryBuilder('m')
      .select('m.stage_id', 'stageId')
      .addSelect('COUNT(*)', 'count')
      .where('m.stage_id IN (:...stageIds)', { stageIds })
      .andWhere('m.is_active = true')
      .andWhere('m.deleted_at IS NULL')
      .groupBy('m.stage_id')
      .getRawMany<{ stageId: string; count: string }>();

    return new Map(results.map((r) => [r.stageId, parseInt(r.count, 10)]));
  }

  async countMissionSummary(): Promise<[total: number, active: number]> {
    const result = await this.repository
      .createQueryBuilder('m')
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE m.is_active = true)`, 'active')
      .where('m.deleted_at IS NULL')
      .getRawOne<{ total: string; active: string }>();

    const total = result?.total ?? '0';
    const active = result?.active ?? '0';
    return [parseInt(total, 10), parseInt(active, 10)];
  }

  async getMissionSubmissionStats(): Promise<MissionStatsRow[]> {
    return this.repository
      .createQueryBuilder('m')
      .select('m.id', 'missionId')
      .addSelect('m.title', 'missionTitle')
      .addSelect('s.title', 'stageTitle')
      .addSelect('COUNT(DISTINCT sub.user_id)', 'totalUsers')
      .addSelect(
        `COUNT(DISTINCT sub.user_id) FILTER (WHERE sub.status = '${SubmissionStatus.PENDING}')`,
        'pending',
      )
      .addSelect(
        `COUNT(DISTINCT sub.user_id) FILTER (WHERE sub.status = '${SubmissionStatus.ACCEPTED}')`,
        'accepted',
      )
      .addSelect(
        `COUNT(DISTINCT sub.user_id) FILTER (WHERE sub.status = '${SubmissionStatus.REJECTED}')`,
        'rejected',
      )
      .innerJoin('stages', 's', 's.id = m.stage_id AND s.deleted_at IS NULL')
      .leftJoin('submissions', 'sub', 'sub.mission_id = m.id AND sub.deleted_at IS NULL')
      .where('m.is_active = true')
      .andWhere('m.deleted_at IS NULL')
      .groupBy('m.id')
      .addGroupBy('m.title')
      .addGroupBy('m.order')
      .addGroupBy('s.title')
      .addGroupBy('s.order')
      .orderBy('s.order', 'ASC')
      .addOrderBy('m.order', 'ASC')
      .getRawMany<MissionStatsRow>();
  }
}
