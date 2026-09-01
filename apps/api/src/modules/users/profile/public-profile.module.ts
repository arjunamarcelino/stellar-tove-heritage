import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { UsersModule } from '../users.module';
import { ProfileImagesModule } from './profile-images.module';
import { ProfileViewModule } from './profile-view.module';
import { ProfileStorageModule } from './storage/profile-storage.module';
import { ProfileService } from './profile.service';
import { ProfileCommitConcurrencyInterceptor } from './profile-commit-concurrency.interceptor';
import { MeProfileController } from './me-profile.controller';
import { MeProfileImageController } from './me-profile-image.controller';
import { PROFILE_DERIVATIVE_QUEUE } from './constants/profile-image.constants';

/**
 * Public profile surface (TOV-30), added to `PUBLIC_MODULES`. Groups the `me` profile controller and the
 * `me/profile-image` lifecycle controller (both share `ProfileService`). Imports the neutral user + image
 * repos, the two-bucket storage, the shared view builder, idempotency, and registers the derivative queue
 * (producer side; the worker is a separate module in app.module).
 */
@Module({
  imports: [
    UsersModule,
    ProfileImagesModule,
    ProfileViewModule,
    ProfileStorageModule,
    IdempotencyModule,
    BullModule.registerQueue({ name: PROFILE_DERIVATIVE_QUEUE }),
  ],
  controllers: [MeProfileController, MeProfileImageController],
  providers: [ProfileService, ProfileCommitConcurrencyInterceptor],
})
export class PublicProfileModule {}
