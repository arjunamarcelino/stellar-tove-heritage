import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { FractionalizationModule } from '@modules/fractionalization/fractionalization.module';
import { OfferingsModule } from '../offerings.module';
import { OFFERING_ESCROW_DEPLOY_QUEUE, OFFERING_RECONCILE_QUEUE } from '../offering.constants';
import { OFFERING_ESCROW_SERVICE } from '../escrow/offering-escrow.service.interface';
import { SorobanOfferingEscrowService } from '../escrow/soroban-offering-escrow.service';
import { OfferingEscrowDeployProcessor } from './offering-escrow-deploy.processor';
import { OfferingReconcileProcessor } from './offering-reconcile.processor';
import { OfferingReconcileScheduler } from './offering-reconcile.scheduler';

/**
 * Provider-only escrow-deploy worker (TOV-154), imported directly into `app.module` (KYC-sweep / fraction
 * worker precedent) — NOT a route surface. Owns the on-chain `OFFERING_ESCROW_SERVICE` (its only consumer,
 * so the neutral OfferingsModule stays config-free), consumes the `offering-escrow-deploy` queue, and runs
 * the `offering-reconcile` sweep (window-open + approval-expiry). Reuses `RELAYER_ACCOUNT_LOCK` from the
 * relayer module to serialize on the shared escrow account key.
 */
@Module({
  imports: [
    OfferingsModule,
    FractionalizationModule,
    WalletsAuditModule,
    RelayerModule,
    BullModule.registerQueue({ name: OFFERING_ESCROW_DEPLOY_QUEUE }, { name: OFFERING_RECONCILE_QUEUE }),
  ],
  providers: [
    { provide: OFFERING_ESCROW_SERVICE, useClass: SorobanOfferingEscrowService },
    OfferingEscrowDeployProcessor,
    OfferingReconcileProcessor,
    OfferingReconcileScheduler,
  ],
})
export class OfferingWorkerModule {}
