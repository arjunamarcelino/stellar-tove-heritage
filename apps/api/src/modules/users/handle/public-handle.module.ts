import { Module } from '@nestjs/common';
import { UsersModule } from '../users.module';
import { HandleService } from './handle.service';
import { MeHandleController } from './me-handle.controller';
import { HandlesController } from './handles.controller';

/**
 * Public collector-handle surface (TOV-26, FR-01.05), added to `PUBLIC_MODULES`. Imports the neutral
 * {@link UsersModule} for its `USER_REPOSITORY` token (handle is a column on `users`). Carries two
 * controllers — authenticated `me/handle` and public `handles/check` — grouped here because they share
 * `HandleService` and the format helpers; RouterModule prefixes both under `api/v1` by their own
 * `@Controller()` path.
 */
@Module({
  imports: [UsersModule],
  controllers: [MeHandleController, HandlesController],
  providers: [HandleService],
})
export class PublicHandleModule {}
