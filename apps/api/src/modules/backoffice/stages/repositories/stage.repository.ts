import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Stage } from '../entities/stage.entity';
import { IStageRepository } from './stage-repository.interface';

@Injectable()
export class StageRepository extends BaseRepository<Stage> implements IStageRepository {
  constructor(dataSource: DataSource) {
    super(Stage, dataSource);
  }
}
