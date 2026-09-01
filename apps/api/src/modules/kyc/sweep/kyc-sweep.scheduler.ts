import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { kycConfig } from '@config/kyc.config';
import { KYC_ORPHAN_SWEEP_QUEUE } from './kyc-sweep.constants';

/**
 * Registers the repeatable KYC orphan-sweep job on boot (review #193). Idempotent — BullMQ dedups a
 * repeatable job by its (name, repeat) key, so re-adding on every boot is safe. Skipped when
 * `KYC_SWEEP_ENABLED=false` (tests / environments that shouldn't run it).
 */
@Injectable()
export class KycSweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(KycSweepScheduler.name);

  constructor(
    @InjectQueue(KYC_ORPHAN_SWEEP_QUEUE) private readonly queue: Queue,
    @Inject(kycConfig.KEY) private readonly config: ConfigType<typeof kycConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.sweepEnabled) {
      return;
    }
    await this.queue.add(
      'sweep',
      {},
      {
        repeat: { pattern: this.config.sweepCron },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    this.logger.log(`KYC orphan sweep scheduled (${this.config.sweepCron})`);
  }
}
