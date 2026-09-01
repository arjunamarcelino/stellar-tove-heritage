import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import { OFFERING_SETTLE_RECONCILE_QUEUE } from '../offering.constants';

/**
 * Registers the repeatable settle-reconcile job on boot (TOV-160). Idempotent (BullMQ dedups by
 * (name, repeat)). Skipped when `OFFERING_ESCROW_RECONCILE_ENABLED=false` (tests). Reuses the shared
 * reconcile cron/enable toggle.
 */
@Injectable()
export class OfferingSettleReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(OfferingSettleReconcileScheduler.name);

  constructor(
    @InjectQueue(OFFERING_SETTLE_RECONCILE_QUEUE) private readonly queue: Queue,
    @Inject(offeringEscrowConfig.KEY) private readonly cfg: ConfigType<typeof offeringEscrowConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Independent toggle from the deploy reconcile (#334): money-settlement recovery is its own risk surface.
    if (!this.cfg.settleReconcileEnabled) return;
    await this.queue.add(
      'settle-reconcile',
      {},
      { repeat: { pattern: this.cfg.reconcileCron }, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.log(`offering settle reconcile scheduled (${this.cfg.reconcileCron})`);
  }
}
