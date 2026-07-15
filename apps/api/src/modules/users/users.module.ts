import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { HandleHistory } from './entities/handle-history.entity';
import { UserRepository } from './repositories/user.repository';
import { USER_REPOSITORY } from './repositories/user-repository.interface';
import { HandleHistoryRepository } from './repositories/handle-history.repository';
import { HANDLE_HISTORY_REPOSITORY } from './repositories/handle-history-repository.interface';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, HandleHistory])],
  providers: [
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: HANDLE_HISTORY_REPOSITORY, useClass: HandleHistoryRepository },
    UsersService,
  ],
  // USER_REPOSITORY is exported for the handle surface (PublicHandleModule, TOV-26); HANDLE_HISTORY_REPOSITORY
  // for the public collector profile surface (CollectorsModule, TOV-27).
  exports: [UsersService, USER_REPOSITORY, HANDLE_HISTORY_REPOSITORY],
})
export class UsersModule {}
