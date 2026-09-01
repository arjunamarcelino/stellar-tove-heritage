import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from '../repositories/profile-image-repository.interface';
import {
  PROFILE_DERIVATIVE_QUEUE,
  PROFILE_DERIVE_JOB,
  PROFILE_PROCESSING_STUCK_MINUTES,
  PROFILE_PROCESSING_FAIL_MINUTES,
  ProfileDeriveJob,
  profileDeriveRedriveJobId,
} from '../constants/profile-image.constants';

/**
 * Re-drives rows stuck in `processing` (TOV-30) — the backstop for a lost enqueue or a crash between the
 * commit and the job. A row stuck past the re-drive threshold is re-enqueued with a UNIQUE jobId (a fixed
 * `${id}:derive` would dedup-swallow the retry against a retained failed job — the reconcile-collision
 * lesson); past the hard-fail threshold it is marked `failed` so the FE poll terminates and its blobs get
 * reaped. The `ready` latch + upsert make re-drives idempotent.
 */
@Injectable()
export class ProfileImageReconcileService {
  private readonly logger = new Logger(ProfileImageReconcileService.name);

  constructor(
    @Inject(PROFILE_IMAGE_REPOSITORY) private readonly images: IProfileImageRepository,
    @InjectQueue(PROFILE_DERIVATIVE_QUEUE) private readonly deriveQueue: Queue<ProfileDeriveJob>,
  ) {}

  async reconcile(): Promise<{ redriven: number; failed: number }> {
    const stuckBefore = new Date(Date.now() - PROFILE_PROCESSING_STUCK_MINUTES * 60_000);
    const failBefore = Date.now() - PROFILE_PROCESSING_FAIL_MINUTES * 60_000;
    const rows = await this.images.findStuckProcessing(stuckBefore, 100);
    let redriven = 0;
    let failed = 0;
    for (const img of rows) {
      if (img.updatedAt.getTime() < failBefore) {
        await this.images.markFailed(img.id);
        failed++;
      } else {
        await this.deriveQueue.add(
          PROFILE_DERIVE_JOB,
          { profileImageId: img.id },
          { jobId: profileDeriveRedriveJobId(img.id, img.updatedAt.getTime()) },
        );
        redriven++;
      }
    }
    if (redriven > 0 || failed > 0) {
      this.logger.log(`profile derivative reconcile: redriven=${redriven} failed=${failed}`);
    }
    return { redriven, failed };
  }
}
