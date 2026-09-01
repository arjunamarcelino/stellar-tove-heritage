import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { OfferingsModule } from '../offerings.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { UsersModule } from '@modules/users/users.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { OfferingBidsController } from './offering-bids.controller';
import { OfferingBidsService } from './offering-bids.service';
import { OFFERING_BID_ESCROW_QUEUE, OFFERING_BID_CANCEL_QUEUE } from './offering-bids.constants';

/**
 * Public authenticated bid surface (TOV-156, FR-05.03), added to `PUBLIC_MODULES` (`api/v1`). Layers the
 * controller + orchestration service on the neutral `OfferingsModule` (for `OFFERING_REPOSITORY` +
 * `OFFERING_BID_REPOSITORY`), the wallet aggregate (`resolveEmbeddedWalletForUser`), `UsersModule` (the
 * whitelist read), the relayer port (buildBid + balance read), the shared idempotency + audit facilities,
 * and the bid-escrow queue (producer side — the worker module is the consumer). relayer/webauthn/
 * offering-bid config is global, injected by KEY.
 */
@Module({
  imports: [
    OfferingsModule,
    WalletsModule,
    UsersModule,
    RelayerModule,
    IdempotencyModule,
    WalletsAuditModule,
    BullModule.registerQueue({ name: OFFERING_BID_ESCROW_QUEUE }),
    BullModule.registerQueue({ name: OFFERING_BID_CANCEL_QUEUE }),
  ],
  controllers: [OfferingBidsController],
  providers: [OfferingBidsService],
})
export class PublicOfferingBidsModule {}
