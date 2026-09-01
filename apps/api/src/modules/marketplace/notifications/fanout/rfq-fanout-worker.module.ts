import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { OfferingsModule } from '@modules/offerings/offerings.module';
import { RfqsModule } from '@modules/marketplace/rfqs/rfqs.module';
import { RfqNotificationsModule } from '../rfq-notifications.module';
import { RFQ_FANOUT_QUEUE, RFQ_FANOUT_RECONCILE_QUEUE } from '../constants/rfq-notification.constants';
import { RfqFanoutService } from './rfq-fanout.service';
import { RfqFanoutProcessor } from './rfq-fanout.processor';
import { RfqFanoutReconcileProcessor } from './rfq-fanout-reconcile.processor';
import { RfqFanoutReconcileScheduler } from './rfq-fanout-reconcile.scheduler';

/**
 * Provider-only RFQ fan-out worker (TOV-174), imported directly into `app.module` (KYC-sweep / offering
 * worker precedent) — NOT a route surface. This is the ONE place the offerings edge is consumed
 * (`OFFERING_BID_REPOSITORY` for the winner finder), so it never leaks onto the notifications read path.
 * Imports the neutral notifications + rfqs domains for their repos and `WalletsAuditModule` for the audit
 * port; registers both fan-out queues (the fanout worker + the reconcile scheduler/processor).
 */
@Module({
  imports: [
    RfqNotificationsModule,
    RfqsModule,
    OfferingsModule,
    WalletsAuditModule,
    BullModule.registerQueue({ name: RFQ_FANOUT_QUEUE }, { name: RFQ_FANOUT_RECONCILE_QUEUE }),
  ],
  providers: [
    RfqFanoutService,
    RfqFanoutProcessor,
    RfqFanoutReconcileProcessor,
    RfqFanoutReconcileScheduler,
  ],
})
export class RfqFanoutWorkerModule {}
