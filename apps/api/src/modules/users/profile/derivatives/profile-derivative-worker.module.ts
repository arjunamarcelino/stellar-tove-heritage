import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProfileImagesModule } from '../profile-images.module';
import { ProfileStorageModule } from '../storage/profile-storage.module';
import { ProfileDerivativeService } from './profile-derivative.service';
import { ProfileImageDerivativeProcessor } from './profile-image-derivative.processor';
import { PROFILE_DERIVATIVE_QUEUE } from '../constants/profile-image.constants';

/**
 * Provider-only derivative worker (TOV-30) — imported into `app.module` (NOT a routed surface), like the
 * KYC/offering/RFQ workers. Consumes the `profile-image-derivatives` queue; reads the private source and
 * writes the private derivatives via `ProfileStorageModule`.
 */
@Module({
  imports: [
    ProfileImagesModule,
    ProfileStorageModule,
    BullModule.registerQueue({ name: PROFILE_DERIVATIVE_QUEUE }),
  ],
  providers: [ProfileDerivativeService, ProfileImageDerivativeProcessor],
})
export class ProfileDerivativeWorkerModule {}
