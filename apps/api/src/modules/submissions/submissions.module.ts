import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Submission } from './entities/submission.entity';
import { SubmissionRepository } from './repositories/submission.repository';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { BackofficeStagesModule } from '../backoffice/stages/stages.module';
import { BackofficeMissionsModule } from '../backoffice/missions/missions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Submission]),
    BackofficeStagesModule,
    BackofficeMissionsModule,
  ],
  controllers: [SubmissionsController],
  providers: [
    { provide: 'ISubmissionRepository', useClass: SubmissionRepository },
    SubmissionsService,
  ],
  exports: ['ISubmissionRepository'],
})
export class UserSubmissionsModule {}
