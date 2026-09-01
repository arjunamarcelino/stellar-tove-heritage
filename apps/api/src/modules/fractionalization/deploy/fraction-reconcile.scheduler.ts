import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { fractionFactoryConfig } from '@config/fraction-factory.config';
import { FRACTION_RECONCILE_QUEUE } from '../fraction.constants';

/**
 * Registers the repeatable fraction-reconcile job on boot (TOV-233). Idempotent (BullMQ dedups a
 * repeatable job by its (name, repeat) key). Skipped when `FRACTION_RECONCILE_ENABLED=false` (tests).
 */
@Injectable()
export class FractionReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(FractionReconcileScheduler.name);

  constructor(
    @InjectQueue(FRACTION_RECONCILE_QUEUE) private readonly queue: Queue,
    @Inject(fractionFactoryConfig.KEY) private readonly cfg: ConfigType<typeof fractionFactoryConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.reconcileEnabled) return;
    await this.queue.add(
      'reconcile',
      {},
      { repeat: { pattern: this.cfg.reconcileCron }, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.log(`fraction reconcile scheduled (${this.cfg.reconcileCron})`);
  }
}
