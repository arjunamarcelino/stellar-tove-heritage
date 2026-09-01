import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { OfferingsModule } from '../../offerings.module';
import { OFFERING_BID_CANCEL_QUEUE } from '../offering-bids.constants';
import { OfferingBidCancelProcessor } from './offering-bid-cancel.processor';

/**
 * Provider-only bid-CANCEL/refund worker (TOV-158), imported directly into `app.module` (the escrow-worker
 * precedent) — NOT a route surface. Consumes the `offering-bid-cancel` queue and relays the passkey-signed
 * `cancel_bid` via the shared `RELAYER_SERVICE` (reusing the same `relayer:account` lock as the escrow
 * worker). Kept a separate module/queue from the escrow worker so the INVERTED money-safety classifier
 * (`canceling → escrowed` revert vs the escrow worker's slot-freeing `casFailed`) stays physically isolated
 * and the two flows have independent pause/drain/alerting. Imports `OfferingsModule` for
 * `OFFERING_BID_REPOSITORY`; stays config-free at the module level.
 */
@Module({
  imports: [
    OfferingsModule,
    RelayerModule,
    WalletsAuditModule,
    BullModule.registerQueue({ name: OFFERING_BID_CANCEL_QUEUE }),
  ],
  providers: [OfferingBidCancelProcessor],
})
export class OfferingBidCancelWorkerModule {}
