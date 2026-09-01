import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { KYC_ORPHAN_SWEEP_QUEUE } from './kyc-sweep.constants';
import { KycOrphanSweepService } from './kyc-orphan-sweep.service';

/** Runs the KYC orphan-blob reconciliation when the repeatable sweep job fires (review #193). */
@Processor(KYC_ORPHAN_SWEEP_QUEUE)
export class KycOrphanSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(KycOrphanSweepProcessor.name);

  constructor(private readonly sweepService: KycOrphanSweepService) {
    super();
  }

  async process(): Promise<void> {
    const result = await this.sweepService.sweep();
    this.logger.log(
      `KYC orphan sweep complete: scanned=${result.scanned} orphans=${result.orphans} deleted=${result.deleted}`,
    );
  }
}
