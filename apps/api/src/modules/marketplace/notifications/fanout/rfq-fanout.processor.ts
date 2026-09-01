import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { RfqFanoutService } from './rfq-fanout.service';
import { RFQ_FANOUT_QUEUE, RfqFanoutJobData, TerminalFanoutError } from '../constants/rfq-notification.constants';

/**
 * Consumes `rfq-fanout` jobs (TOV-174). Pure DB fan-out, so `concurrency > 1` safely parallelizes DISTINCT
 * rfqIds (same-rfqId safety comes from the `fanned_out_at` latch + `jobId=rfqId` dedup, NOT serialization).
 * Retryable-by-default: only a deterministic {@link TerminalFanoutError} (RFQ gone) becomes an
 * `UnrecoverableError`; everything else rethrows so BullMQ retries with backoff.
 *
 * `@Processor` decorator options are evaluated at class-decoration time (before DI), so `concurrency` reads
 * `process.env` directly — the same sanctioned pre-DI bypass as the RouterModule route prefixes (`main.ts`
 * imports `dotenv/config` first, and Joi validates `RFQ_FANOUT_WORKER_CONCURRENCY` at boot).
 */
@Processor(RFQ_FANOUT_QUEUE, {
  concurrency: Number(process.env.RFQ_FANOUT_WORKER_CONCURRENCY ?? '5'),
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class RfqFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(RfqFanoutProcessor.name);

  constructor(private readonly fanoutService: RfqFanoutService) {
    super();
  }

  async process(job: Job<RfqFanoutJobData>): Promise<void> {
    try {
      await this.fanoutService.fanout(job.data.rfqId);
    } catch (err) {
      if (err instanceof TerminalFanoutError) {
        // Deterministic: the RFQ is gone. Stop retrying (would burn the whole backoff budget for nothing).
        throw new UnrecoverableError(err.message);
      }
      // Transient (DB/connection) — let BullMQ retry with backoff.
      this.logger.warn(`rfq fan-out transient failure [rfq=${job.data.rfqId}]: ${String(err)}`);
      throw err;
    }
  }
}
