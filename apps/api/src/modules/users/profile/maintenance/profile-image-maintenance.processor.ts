import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  PROFILE_MAINTENANCE_QUEUE,
  PROFILE_RECONCILE_JOB,
  PROFILE_REAP_JOB,
} from '../constants/profile-image.constants';
import { ProfileImageReconcileService } from './profile-image-reconcile.service';
import { ProfileImageReaperService } from './profile-image-reaper.service';

/** Runs the two repeatable maintenance jobs (TOV-30): reconcile stuck-processing, reap abandoned rows/blobs. */
@Processor(PROFILE_MAINTENANCE_QUEUE)
export class ProfileImageMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfileImageMaintenanceProcessor.name);

  constructor(
    private readonly reconcile: ProfileImageReconcileService,
    private readonly reaper: ProfileImageReaperService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case PROFILE_RECONCILE_JOB:
        await this.reconcile.reconcile();
        return;
      case PROFILE_REAP_JOB:
        await this.reaper.reap();
        return;
      default:
        this.logger.warn(`unknown profile maintenance job: ${job.name}`);
    }
  }
}
