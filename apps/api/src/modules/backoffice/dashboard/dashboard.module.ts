import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@modules/users/users.module';
import { BackofficeMissionsModule } from '../missions/missions.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

@Module({
  imports: [JwtModule.register({}), UsersModule, BackofficeMissionsModule],
  controllers: [DashboardController],
  providers: [DashboardService, BackofficeGuard],
})
export class BackofficeDashboardModule {}
