import { Module } from '@nestjs/common';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { UsersModule } from '@modules/users/users.module';
import { FractionalizationModule } from '@modules/fractionalization/fractionalization.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { FRACTION_READ_SERVICE } from '@modules/fractionalization/fraction-read.service.interface';
import { SorobanFractionReadService } from '@modules/fractionalization/soroban-fraction-read.service';
import { RfqsModule } from '@modules/marketplace/rfqs/rfqs.module';
import { QuotesModule } from './quotes.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

/**
 * Public authenticated quote-submission surface (TOV-175, FR-06.03), layered on the neutral quote domain.
 * Added to `PUBLIC_MODULES`. Imports the neutral `QuotesModule` (QUOTE_REPOSITORY), `RfqsModule`
 * (RFQ_REPOSITORY — the parent RFQ read), `FractionalizationModule` (FRACTION_CONTRACT_REPOSITORY),
 * `UsersModule` (whitelist gate), `WalletsModule` (primary settlement wallet), `WalletsAuditModule`, and
 * `IdempotencyModule`. Binds `FRACTION_READ_SERVICE` locally (on the global `fractionRead` config) rather
 * than exporting it from `FractionalizationModule`, so no working module is touched; tests override the token.
 */
@Module({
  imports: [
    QuotesModule,
    RfqsModule,
    FractionalizationModule,
    UsersModule,
    WalletsModule,
    WalletsAuditModule,
    IdempotencyModule,
  ],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    { provide: FRACTION_READ_SERVICE, useClass: SorobanFractionReadService },
  ],
})
export class PublicQuotesModule {}
