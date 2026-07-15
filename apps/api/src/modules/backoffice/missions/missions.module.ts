import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Mission } from './entities/mission.entity';
import { MissionRepository } from './repositories/mission.repository';
import { MissionsService } from './missions.service';
import { MissionsController } from './missions.controller';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { BackofficeStagesModule } from '../stages/stages.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Mission]),
    JwtModule.register({}),
    BackofficeStagesModule,
  ],
  controllers: [MissionsController],
  providers: [
    { provide: 'IMissionRepository', useClass: MissionRepository },
    MissionsService,
    BackofficeGuard,
  ],
  exports: ['IMissionRepository'],
})
export class BackofficeMissionsModule {}
