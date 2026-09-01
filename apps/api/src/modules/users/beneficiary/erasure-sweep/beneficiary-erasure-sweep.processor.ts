import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { BENEFICIARY_ERASURE_SWEEP_QUEUE } from './beneficiary-erasure-sweep.constants';
import { BeneficiaryErasureSweepService } from './beneficiary-erasure-sweep.service';

/** Runs the beneficiary erasure-reconcile sweep when the repeatable job fires (TOV-31, review todo 418). */
@Processor(BENEFICIARY_ERASURE_SWEEP_QUEUE)
export class BeneficiaryErasureSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(BeneficiaryErasureSweepProcessor.name);

  constructor(private readonly sweepService: BeneficiaryErasureSweepService) {
    super();
  }

  async process(): Promise<void> {
    const deleted = await this.sweepService.sweep();
    if (deleted > 0) this.logger.warn(`beneficiary erasure sweep purged ${deleted} orphaned row(s)`);
  }
}
