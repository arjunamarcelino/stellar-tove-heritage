import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { OfferingsModule } from '../offerings.module';
import {
  OFFERING_SETTLE_QUEUE,
  OFFERING_SETTLE_RECONCILE_QUEUE,
} from '../offering.constants';
import { OFFERING_ESCROW_SERVICE } from '../escrow/offering-escrow.service.interface';
import { SorobanOfferingEscrowService } from '../escrow/soroban-offering-escrow.service';
import { OfferingSettleProcessor } from './offering-settle.processor';
import { OfferingSettleReconcileProcessor } from './offering-settle-reconcile.processor';
import { OfferingSettleReconcileScheduler } from './offering-settle-reconcile.scheduler';

/**
 * Provider-only settlement worker (TOV-160, FR-05.05), imported directly into `app.module` (deploy-worker
 * precedent) — NOT a route surface. Binds the on-chain `OFFERING_ESCROW_SERVICE` in the WORKER module (so
 * the neutral `OfferingsModule` stays config-free and importable by the fixed-config integration harness),
 * consumes `offering-settle`, and OWNS the stale-`subscribed` reconcile sweep (`offering-settle-reconcile`)
 * — the deploy reconcile only injects the deploy queue, so this sweep lives here. Reuses
 * `RELAYER_ACCOUNT_LOCK` from the relayer module (the settle adapter serializes on the shared escrow key).
 */
@Module({
  imports: [
    OfferingsModule,
    WalletsAuditModule,
    RelayerModule,
    BullModule.registerQueue(
      { name: OFFERING_SETTLE_QUEUE },
      { name: OFFERING_SETTLE_RECONCILE_QUEUE },
    ),
  ],
  providers: [
    { provide: OFFERING_ESCROW_SERVICE, useClass: SorobanOfferingEscrowService },
    OfferingSettleProcessor,
    OfferingSettleReconcileProcessor,
    OfferingSettleReconcileScheduler,
  ],
})
export class OfferingSettleWorkerModule {}
