import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { rfqFanoutConfig } from '@config/rfq-fanout.config';
import {
  RFQ_REPOSITORY,
  IRfqRepository,
} from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import {
  RFQ_FANOUT_QUEUE,
  RFQ_FANOUT_RECONCILE_QUEUE,
  RFQ_FANOUT_JOB,
  RFQ_FANOUT_JOB_OPTS,
  RfqFanoutJobData,
} from '../constants/rfq-notification.constants';

/**
 * Crash / retry-exhaustion backstop (TOV-174): re-enqueues un-latched RFQs whose primary fan-out job either
 * never enqueued (commit→enqueue crash) OR exhausted its retries. Pure re-enqueue — never writes notification
 * rows itself (one write path).
 *
 * The re-drive uses a UNIQUE jobId (`${rfqId}:reconcile:${ts}`), NOT `jobId=rfqId`: a retry-exhausted primary
 * job sits in the *failed* set (retained by `removeOnFail`), and re-adding `jobId=rfqId` while it lingers is a
 * BullMQ dedup **no-op** — which silently defeated the backstop (todo 361). A unique jobId always executes;
 * the DB latch + `UQ_rfq_notifications_recipient_channel` keep any number of re-drives idempotent. The
 * `graceMs` lower bound (finder) prevents re-driving a job that is still validly running. RFQs un-latched
 * past `windowMs` are orphaned (accepted).
 */
@Processor(RFQ_FANOUT_RECONCILE_QUEUE, { concurrency: 1 })
export class RfqFanoutReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(RfqFanoutReconcileProcessor.name);

  constructor(
    @Inject(rfqFanoutConfig.KEY) private readonly cfg: ConfigType<typeof rfqFanoutConfig>,
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    @InjectQueue(RFQ_FANOUT_QUEUE) private readonly fanoutQueue: Queue<RfqFanoutJobData>,
  ) {
    super();
  }

  async process(): Promise<void> {
    const ids = await this.rfqs.findUnfannedSince({
      windowMs: this.cfg.reconcileWindowMs,
      graceMs: this.cfg.reconcileGraceMs,
      limit: this.cfg.reconcileBatch,
    });
    // Unique jobId per re-drive (see class doc) so a retained failed primary job never dedups it to a no-op.
    const runTs = Date.now();
    for (const rfqId of ids) {
      await this.fanoutQueue.add(
        RFQ_FANOUT_JOB,
        { rfqId },
        { jobId: `${rfqId}:reconcile:${runTs}`, ...RFQ_FANOUT_JOB_OPTS },
      );
    }
    if (ids.length > 0) this.logger.log(`rfq fan-out reconcile re-drove ${ids.length} stalled RFQ(s)`);
  }
}
