import { Module } from '@nestjs/common';
import { UsersModule } from '@modules/users/users.module';
import { CollectorsController } from './collectors.controller';
import { CollectorsService } from './collectors.service';

/**
 * Public collector profile surface (TOV-27, FR-01.06). Imports the neutral `UsersModule` for the
 * `USER_REPOSITORY` (current-handle lookup) and `HANDLE_HISTORY_REPOSITORY` (previous-handles read) tokens.
 * Added to `PUBLIC_MODULES`, so `RouterModule` prefixes the controller to `api/v1`.
 */
@Module({
  imports: [UsersModule],
  controllers: [CollectorsController],
  providers: [CollectorsService],
})
export class CollectorsModule {}
