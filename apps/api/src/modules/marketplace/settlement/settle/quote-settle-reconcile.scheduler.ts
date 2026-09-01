import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { marketplaceSettlementConfig } from '@config/marketplace-settlement.config';
import { QUOTE_SETTLE_RECONCILE_QUEUE } from './quote-settle.job';

/**
 * Registers the repeatable settle-reconcile job on boot (TOV-177 #382). Idempotent (BullMQ dedups by
 * (name, repeat)). Skipped when `MARKETPLACE_SETTLEMENT_RECONCILE_ENABLED=false` (tests). Mirrors the offering
 * settle reconcile scheduler.
 */
@Injectable()
export class QuoteSettleReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(QuoteSettleReconcileScheduler.name);

  constructor(
    @InjectQueue(QUOTE_SETTLE_RECONCILE_QUEUE) private readonly queue: Queue,
    @Inject(marketplaceSettlementConfig.KEY) private readonly cfg: ConfigType<typeof marketplaceSettlementConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.reconcileEnabled) return;
    await this.queue.add(
      'settle-reconcile',
      {},
      { repeat: { pattern: this.cfg.reconcileCron }, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.log(`quote settle reconcile scheduled (${this.cfg.reconcileCron})`);
  }
}
