import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { beneficiaryConfig } from '@config/beneficiary.config';
import { BENEFICIARY_ERASURE_SWEEP_QUEUE } from './beneficiary-erasure-sweep.constants';

/**
 * Registers the repeatable beneficiary erasure-reconcile job on boot (TOV-31, review todo 418). Idempotent —
 * BullMQ dedups a repeatable job by its (name, repeat) key. Skipped when `BENEFICIARY_ERASURE_SWEEP_ENABLED=false`.
 */
@Injectable()
export class BeneficiaryErasureSweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(BeneficiaryErasureSweepScheduler.name);

  constructor(
    @InjectQueue(BENEFICIARY_ERASURE_SWEEP_QUEUE) private readonly queue: Queue,
    @Inject(beneficiaryConfig.KEY) private readonly config: ConfigType<typeof beneficiaryConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.erasureSweepEnabled) {
      return;
    }
    await this.queue.add(
      'sweep',
      {},
      { repeat: { pattern: this.config.erasureSweepCron }, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.log(`beneficiary erasure sweep scheduled (${this.config.erasureSweepCron})`);
  }
}
