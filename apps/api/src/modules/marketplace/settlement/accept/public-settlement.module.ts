import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { UsersModule } from '@modules/users/users.module';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { FractionalizationModule } from '@modules/fractionalization/fractionalization.module';
import { FRACTION_READ_SERVICE } from '@modules/fractionalization/fraction-read.service.interface';
import { SorobanFractionReadService } from '@modules/fractionalization/soroban-fraction-read.service';
import { RfqsModule } from '@modules/marketplace/rfqs/rfqs.module';
import { QuotesModule } from '@modules/marketplace/quotes/quotes.module';
import { SettlementModule } from '../settlement.module';
import { QUOTE_SETTLE_QUEUE } from '../settle/quote-settle.job';
import { AuthorizeController } from './authorize.controller';
import { AuthorizeService } from './authorize.service';
import { AcceptController } from './accept.controller';
import { AcceptService } from './accept.service';

/**
 * Public authenticated secondary-settlement surface (TOV-177, FR-06.04). Currently hosts the seller-authorize
 * routes (`:rfqId/quotes/:quoteId/authorize*`); the buyer-accept routes + poll layer on top later. Imports the
 * neutral quote/rfq repos, `FractionalizationModule` (contracts + the balance-read port), `WalletsModule`
 * (embedded-wallet resolution), `UsersModule` (whitelist), the audit + idempotency facilities, and
 * `RelayerModule` (the two-signature accept relayer methods). Added to `PUBLIC_MODULES`.
 */
@Module({
  imports: [
    RelayerModule,
    WalletsModule,
    WalletsAuditModule,
    UsersModule,
    IdempotencyModule,
    FractionalizationModule,
    RfqsModule,
    QuotesModule,
    SettlementModule,
    BullModule.registerQueue({ name: QUOTE_SETTLE_QUEUE }),
  ],
  controllers: [AuthorizeController, AcceptController],
  providers: [AuthorizeService, AcceptService, { provide: FRACTION_READ_SERVICE, useClass: SorobanFractionReadService }],
})
export class PublicSettlementModule {}
