import { Module } from '@nestjs/common';
import { UserStagesService } from './stages.service';
import { UserStagesController } from './stages.controller';
import { BackofficeStagesModule } from '../backoffice/stages/stages.module';
import { BackofficeMissionsModule } from '../backoffice/missions/missions.module';
import { UserSubmissionsModule } from '../submissions/submissions.module';

@Module({
  imports: [BackofficeStagesModule, BackofficeMissionsModule, UserSubmissionsModule],
  controllers: [UserStagesController],
  providers: [UserStagesService],
  exports: [UserStagesService],
})
export class UserStagesModule {}
