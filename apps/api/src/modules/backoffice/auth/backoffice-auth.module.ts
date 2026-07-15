import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminsModule } from '../admins/admins.module';
import { BackofficeAuthController } from './backoffice-auth.controller';
import { BackofficeAuthService } from './backoffice-auth.service';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

@Module({
  imports: [JwtModule.register({}), AdminsModule],
  controllers: [BackofficeAuthController],
  providers: [BackofficeAuthService, BackofficeGuard],
})
export class BackofficeAuthModule {}
