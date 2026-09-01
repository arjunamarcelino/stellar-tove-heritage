import { randomUUID } from 'node:crypto';
import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '../repositories/offering-repository.interface';
import { OFFERING_SETTLE_QUEUE, OFFERING_SETTLE_RECONCILE_QUEUE } from '../offering.constants';

/**
 * Stale-`subscribed` re-drive sweep (TOV-160, mandatory §J). A row wedged in `subscribed` past
 * `settleGraceMs` with NO settle-failure stamp = the crash-between-commit-and-enqueue window: the settle
 * job was NEVER enqueued (best-effort dispatch after the DB commit), so BullMQ attempts can't recover it —
 * only this sweep re-drives it (the settle processor is idempotent via self-heal-first `readStatus`, and
 * no-ops unless the row is still `subscribed`, so a duplicate is harmless). Terminally-failed rows
 * (`settle_failed_at` set) are excluded by the finder — they need an admin re-drive, not an auto loop.
 *
 * Lives in the settle worker module (it owns `OFFERING_SETTLE_QUEUE`), NOT the deploy reconcile. DB-only
 * read + a best-effort queue add per row; a single failing row logs and continues.
 */
@Processor(OFFERING_SETTLE_RECONCILE_QUEUE, { concurrency: 1 })
export class OfferingSettleReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferingSettleReconcileProcessor.name);

  constructor(
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
    @Inject(offeringEscrowConfig.KEY) private readonly cfg: ConfigType<typeof offeringEscrowConfig>,
    @InjectQueue(OFFERING_SETTLE_QUEUE) private readonly settleQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<void> {
    const stale = await this.offerings.findStaleSubscribed(
      this.cfg.settleGraceMs,
      this.cfg.reconcileBatch,
    );
    let requeued = 0;
    for (const o of stale) {
      try {
        await this.settleQueue.add(
          'settle',
          { offeringId: o.id },
          {
            jobId: `settle:${o.id}:${randomUUID()}`,
            attempts: 8,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600, count: 100 },
            removeOnFail: { age: 86400 },
          },
        );
        requeued += 1;
      } catch (err) {
        this.logger.warn(`settle reconcile re-enqueue failed [offering=${o.id}]: ${String(err)}`);
      }
    }
    if (requeued > 0) {
      this.logger.warn(`offering settle reconcile re-enqueued ${requeued}/${stale.length} stale settlement(s)`);
    }
  }
}
