import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { OfferingsModule } from '@modules/offerings/offerings.module';
import {
  OFFERING_ESCROW_DEPLOY_QUEUE,
  OFFERING_SETTLE_QUEUE,
} from '@modules/offerings/offering.constants';
import { FractionalizationModule } from '@modules/fractionalization/fractionalization.module';
import { BackofficeOfferingsController } from './backoffice-offerings.controller';
import { BackofficeOfferingsService } from './backoffice-offerings.service';
import { BackofficeOfferingSettleService } from './backoffice-offering-settle.service';

/**
 * Backoffice offering-planning surface (TOV-152): HTTP + pure DB write. Deliberately imports NO
 * `WalletsModule` (no wallet resolution) and NO `BullModule` (no async worker) — the divergence from the
 * `fractionalize` sibling — because planning only reads the already-persisted `fraction_contracts` row and
 * inserts one `offerings` row. `OfferingsModule` provides `OFFERING_REPOSITORY`; `FractionalizationModule`
 * provides `ARTWORK_REPOSITORY` + `FRACTION_CONTRACT_REPOSITORY` (`computePublicFloat` is a pure path import).
 */
@Module({
  imports: [
    JwtModule.register({}),
    OfferingsModule,
    FractionalizationModule,
    IdempotencyModule,
    WalletsAuditModule,
    // Producer side (TOV-154 approve → deploy; TOV-160 settle → settlement). The workers CONSUME these
    // queues from their separate worker modules. OfferingsModule also provides OFFERING_BID_REPOSITORY
    // (the settle preconditions + clearing preview read the bid book).
    BullModule.registerQueue(
      { name: OFFERING_ESCROW_DEPLOY_QUEUE },
      { name: OFFERING_SETTLE_QUEUE },
    ),
  ],
  controllers: [BackofficeOfferingsController],
  providers: [BackofficeGuard, BackofficeOfferingsService, BackofficeOfferingSettleService],
})
export class BackofficeOfferingsModule {}
