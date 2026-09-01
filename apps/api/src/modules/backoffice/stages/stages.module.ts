import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Stage } from './entities/stage.entity';
import { StageRepository } from './repositories/stage.repository';
import { Mission } from '../missions/entities/mission.entity';
import { MissionRepository } from '../missions/repositories/mission.repository';
import { StagesService } from './stages.service';
import { StagesController } from './stages.controller';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Stage, Mission]), JwtModule.register({})],
  controllers: [StagesController],
  providers: [
    { provide: 'IStageRepository', useClass: StageRepository },
    { provide: 'IMissionRepository', useClass: MissionRepository },
    StagesService,
    BackofficeGuard,
  ],
  exports: ['IStageRepository'],
})
export class BackofficeStagesModule {}
