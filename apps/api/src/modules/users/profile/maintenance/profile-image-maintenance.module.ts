import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProfileImagesModule } from '../profile-images.module';
import { ProfileStorageModule } from '../storage/profile-storage.module';
import { ProfileImageReconcileService } from './profile-image-reconcile.service';
import { ProfileImageReaperService } from './profile-image-reaper.service';
import { ProfileImageMaintenanceProcessor } from './profile-image-maintenance.processor';
import { ProfileImageMaintenanceScheduler } from './profile-image-maintenance.scheduler';
import {
  PROFILE_MAINTENANCE_QUEUE,
  PROFILE_DERIVATIVE_QUEUE,
} from '../constants/profile-image.constants';

/**
 * Provider-only profile-image maintenance (TOV-30) — imported into `app.module`. Registers the maintenance
 * queue (its own repeatable jobs) and the derivative queue (the reconcile service re-enqueues onto it).
 * Env-gated by `maintenanceEnabled` via the scheduler.
 */
@Module({
  imports: [
    ProfileImagesModule,
    ProfileStorageModule,
    BullModule.registerQueue(
      { name: PROFILE_MAINTENANCE_QUEUE },
      { name: PROFILE_DERIVATIVE_QUEUE },
    ),
  ],
  providers: [
    ProfileImageReconcileService,
    ProfileImageReaperService,
    ProfileImageMaintenanceProcessor,
    ProfileImageMaintenanceScheduler,
  ],
})
export class ProfileImageMaintenanceModule {}
