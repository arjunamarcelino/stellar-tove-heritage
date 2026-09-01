import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@modules/users/users.module';
import { ProfileErasureModule } from '@modules/users/profile/profile-erasure.module';
import { BeneficiaryErasureModule } from '@modules/users/beneficiary/beneficiary-erasure.module';
import { BackofficeUsersController } from './backoffice-users.controller';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

@Module({
  imports: [JwtModule.register({}), UsersModule, ProfileErasureModule, BeneficiaryErasureModule],
  controllers: [BackofficeUsersController],
  providers: [BackofficeGuard],
})
export class BackofficeUsersModule {}
