import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BackofficeSubmissionsService } from './submissions.service';
import { BackofficeSubmissionsController } from './submissions.controller';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { UserSubmissionsModule } from '../../submissions/submissions.module';

@Module({
  imports: [JwtModule.register({}), UserSubmissionsModule],
  controllers: [BackofficeSubmissionsController],
  providers: [BackofficeSubmissionsService, BackofficeGuard],
})
export class BackofficeSubmissionsModule {}
