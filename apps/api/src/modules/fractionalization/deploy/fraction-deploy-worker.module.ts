import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { TimelineModule } from '@modules/timeline/timeline.module';
import { FractionalizationModule } from '../fractionalization.module';
import { FRACTION_DEPLOY_QUEUE, FRACTION_RECONCILE_QUEUE } from '../fraction.constants';
import { FractionDeployProcessor } from './fraction-deploy.processor';
import { FractionReconcileProcessor } from './fraction-reconcile.processor';
import { FractionReconcileScheduler } from './fraction-reconcile.scheduler';

/**
 * Provider-only deploy worker (TOV-233), imported directly into `app.module` (KYC-sweep precedent) — NOT
 * a route surface. Consumes the `fraction-deploy` queue (per-artwork FractionToken deploy) and runs the
 * `fraction-reconcile` sweeper (crash-window backstop). Separated from the backoffice producer so a
 * future API/worker process split keeps only this module.
 */
@Module({
  imports: [
    FractionalizationModule,
    WalletsAuditModule,
    TimelineModule,
    BullModule.registerQueue({ name: FRACTION_DEPLOY_QUEUE }, { name: FRACTION_RECONCILE_QUEUE }),
  ],
  providers: [FractionDeployProcessor, FractionReconcileProcessor, FractionReconcileScheduler],
})
export class FractionDeployWorkerModule {}
