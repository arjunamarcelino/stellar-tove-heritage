import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { UsersModule } from '@modules/users/users.module';
import { FractionalizationModule } from '@modules/fractionalization/fractionalization.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { RFQ_FANOUT_QUEUE } from '@modules/marketplace/notifications/constants/rfq-notification.constants';
import { RfqsModule } from './rfqs.module';
import { RfqsController } from './rfqs.controller';
import { RfqsService } from './rfqs.service';
import { RfqBalanceAdvisor } from './rfq-balance.advisor';

/**
 * Public authenticated RFQ surface (TOV-172, FR-06.01), added to `PUBLIC_MODULES` (`api/v1`). Layers the
 * controller + orchestration service on the neutral `RfqsModule` (for `RFQ_REPOSITORY`), `UsersModule`
 * (the whitelist read), `FractionalizationModule` (`ARTWORK_REPOSITORY` + `FRACTION_CONTRACT_REPOSITORY`),
 * the wallet aggregate + relayer port (the soft-warn balance read, via `RfqBalanceAdvisor`), and the shared
 * idempotency + audit facilities. relayer config is global, injected by KEY.
 */
@Module({
  imports: [
    RfqsModule,
    UsersModule,
    FractionalizationModule,
    RelayerModule,
    WalletsModule,
    WalletsAuditModule,
    IdempotencyModule,
    // TOV-174: producer side of the fan-out. Register the queue here (the surface module owns RfqsService)
    // so the neutral RfqsModule stays queue-free; the worker module registers the same queue name.
    BullModule.registerQueue({ name: RFQ_FANOUT_QUEUE }),
  ],
  controllers: [RfqsController],
  providers: [RfqsService, RfqBalanceAdvisor],
})
export class PublicRfqsModule {}
