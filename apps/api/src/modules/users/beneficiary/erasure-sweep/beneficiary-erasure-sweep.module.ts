import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BeneficiaryModule } from '../beneficiary.module';
import { BENEFICIARY_ERASURE_SWEEP_QUEUE } from './beneficiary-erasure-sweep.constants';
import { BeneficiaryErasureSweepService } from './beneficiary-erasure-sweep.service';
import { BeneficiaryErasureSweepProcessor } from './beneficiary-erasure-sweep.processor';
import { BeneficiaryErasureSweepScheduler } from './beneficiary-erasure-sweep.scheduler';

/**
 * Provider-only module (imported by `app.module`, not a route surface): the beneficiary erasure-reconcile
 * backstop (TOV-31, review todo 418). Registers the `beneficiary-erasure-sweep` BullMQ queue + processor,
 * the sweep service, and the boot-time scheduler. Reuses `BENEFICIARY_REPOSITORY` via `BeneficiaryModule`.
 */
@Module({
  imports: [BullModule.registerQueue({ name: BENEFICIARY_ERASURE_SWEEP_QUEUE }), BeneficiaryModule],
  providers: [
    BeneficiaryErasureSweepService,
    BeneficiaryErasureSweepProcessor,
    BeneficiaryErasureSweepScheduler,
  ],
})
export class BeneficiaryErasureSweepModule {}
