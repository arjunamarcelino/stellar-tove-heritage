import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import { OFFERING_RECONCILE_QUEUE } from '../offering.constants';

/**
 * Registers the repeatable offering-reconcile job on boot (TOV-154, WS8). Idempotent (BullMQ dedups a
 * repeatable job by its (name, repeat) key). Skipped when `OFFERING_ESCROW_RECONCILE_ENABLED=false`
 * (tests). Mirrors `FractionReconcileScheduler`.
 */
@Injectable()
export class OfferingReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(OfferingReconcileScheduler.name);

  constructor(
    @InjectQueue(OFFERING_RECONCILE_QUEUE) private readonly queue: Queue,
    @Inject(offeringEscrowConfig.KEY) private readonly cfg: ConfigType<typeof offeringEscrowConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.reconcileEnabled) return;
    await this.queue.add(
      'reconcile',
      {},
      { repeat: { pattern: this.cfg.reconcileCron }, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.log(`offering reconcile scheduled (${this.cfg.reconcileCron})`);
  }
}
