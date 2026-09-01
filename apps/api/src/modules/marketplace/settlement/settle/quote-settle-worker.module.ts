import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { TimelineModule } from '@modules/timeline/timeline.module';
import { RfqsModule } from '@modules/marketplace/rfqs/rfqs.module';
import { QuotesModule } from '@modules/marketplace/quotes/quotes.module';
import { SettlementModule } from '../settlement.module';
import { MARKETPLACE_SETTLER_READ_SERVICE } from '../marketplace-settler-read.service.interface';
import { SorobanMarketplaceSettlerReadService } from '../soroban-marketplace-settler-read.service';
import { QUOTE_SETTLE_QUEUE, QUOTE_SETTLE_RECONCILE_QUEUE } from './quote-settle.job';
import { QuoteSettleProcessor } from './quote-settle.processor';
import { QuoteSettleReconcileProcessor } from './quote-settle-reconcile.processor';
import { QuoteSettleReconcileScheduler } from './quote-settle-reconcile.scheduler';
import { SettlePersistenceService } from './settle-persistence.service';

/**
 * Provider-only settle worker (TOV-177, FR-06.05). Binds the `MARKETPLACE_SETTLER_READ_SERVICE` (is_settled
 * self-heal oracle) HERE (keeps the neutral SettlementModule config-free) + the `QuoteSettleProcessor` and the
 * lost-job reconcile backstop (#382: `QuoteSettleReconcileScheduler` + `QuoteSettleReconcileProcessor`, sharing
 * the atomic `SettlePersistenceService`). Added to `app.module` (not a public leaf). Consumes
 * `QUOTE_SETTLE_QUEUE`; the accept surface is the producer.
 */
@Module({
  imports: [
    SettlementModule,
    QuotesModule,
    RfqsModule,
    RelayerModule,
    WalletsAuditModule,
    TimelineModule,
    BullModule.registerQueue({ name: QUOTE_SETTLE_QUEUE }, { name: QUOTE_SETTLE_RECONCILE_QUEUE }),
  ],
  providers: [
    SettlePersistenceService,
    QuoteSettleProcessor,
    QuoteSettleReconcileProcessor,
    QuoteSettleReconcileScheduler,
    { provide: MARKETPLACE_SETTLER_READ_SERVICE, useClass: SorobanMarketplaceSettlerReadService },
  ],
})
export class QuoteSettleWorkerModule {}
