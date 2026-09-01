import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { rfqFanoutConfig } from '@config/rfq-fanout.config';
import { RFQ_FANOUT_RECONCILE_QUEUE, RFQ_FANOUT_SCHEDULER_KEY } from '../constants/rfq-notification.constants';

/**
 * Registers the repeatable rfq-fanout reconcile job on boot (TOV-174). Idempotent — BullMQ dedups a
 * repeatable by its (name, repeat) key, so re-registering on every boot yields one scheduler (mirrors
 * `FractionReconcileScheduler`). Skipped when `RFQ_FANOUT_RECONCILE_ENABLED=false` (tests).
 */
@Injectable()
export class RfqFanoutReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(RfqFanoutReconcileScheduler.name);

  constructor(
    @InjectQueue(RFQ_FANOUT_RECONCILE_QUEUE) private readonly queue: Queue,
    @Inject(rfqFanoutConfig.KEY) private readonly cfg: ConfigType<typeof rfqFanoutConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.reconcileEnabled) return;
    await this.queue.add(
      RFQ_FANOUT_SCHEDULER_KEY,
      {},
      { repeat: { pattern: this.cfg.reconcileCron }, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.log(`rfq fan-out reconcile scheduled (${this.cfg.reconcileCron})`);
  }
}
