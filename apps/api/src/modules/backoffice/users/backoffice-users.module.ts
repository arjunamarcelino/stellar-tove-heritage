import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@modules/users/users.module';
import { BackofficeUsersController } from './backoffice-users.controller';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [BackofficeUsersController],
  providers: [BackofficeGuard],
})
export class BackofficeUsersModule {}
