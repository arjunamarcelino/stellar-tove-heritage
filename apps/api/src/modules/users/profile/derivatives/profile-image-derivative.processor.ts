import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { PROFILE_DERIVATIVE_QUEUE, ProfileDeriveJob } from '../constants/profile-image.constants';
import { ProfileDerivativeService, ProfileDeriveTerminalError } from './profile-derivative.service';

/**
 * BullMQ worker that generates avatar derivatives (TOV-30). Deterministic failures (invalid image) become
 * `UnrecoverableError` so the job stops retrying (the row is already `failed`); transient failures rethrow
 * for retry. `concurrency` is read from `process.env` pre-DI (dotenv/config runs first in main.ts; Joi
 * validated the var at boot) — the same sanctioned pre-DI bypass the other workers use.
 */
@Processor(PROFILE_DERIVATIVE_QUEUE, {
  concurrency: Number(process.env.PROFILE_DERIVATIVE_WORKER_CONCURRENCY ?? '2'),
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class ProfileImageDerivativeProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfileImageDerivativeProcessor.name);

  constructor(private readonly service: ProfileDerivativeService) {
    super();
  }

  async process(job: Job<ProfileDeriveJob>): Promise<void> {
    try {
      await this.service.generate(job.data.profileImageId);
    } catch (err) {
      if (err instanceof ProfileDeriveTerminalError) {
        throw new UnrecoverableError(err.message);
      }
      this.logger.warn(`derivative job failed (will retry) [image=${job.data.profileImageId}]: ${String(err)}`);
      throw err;
    }
  }
}
