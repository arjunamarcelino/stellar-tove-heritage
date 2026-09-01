import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { FractionalizationModule } from '@modules/fractionalization/fractionalization.module';
import { FRACTION_DEPLOY_QUEUE } from '@modules/fractionalization/fraction.constants';
import { OfferingsModule } from '@modules/offerings/offerings.module';
import { BackofficeArtworksController } from './backoffice-artworks.controller';
import { BackofficeArtworksService } from './backoffice-artworks.service';

/**
 * Backoffice fractionalize surface (TOV-233): HTTP producer only. The controller enqueues onto
 * `FRACTION_DEPLOY_QUEUE`; the processor/scheduler live in the provider-only `FractionDeployWorkerModule`
 * (imported into `app.module`) so the worker's lifecycle isn't coupled to the route tree.
 */
@Module({
  imports: [
    JwtModule.register({}),
    FractionalizationModule,
    OfferingsModule, // provides OFFERING_REPOSITORY for the activeOffering embed
    IdempotencyModule,
    WalletsAuditModule,
    WalletsModule,
    BullModule.registerQueue({ name: FRACTION_DEPLOY_QUEUE }),
  ],
  controllers: [BackofficeArtworksController],
  providers: [BackofficeGuard, BackofficeArtworksService],
})
export class BackofficeArtworksModule {}
