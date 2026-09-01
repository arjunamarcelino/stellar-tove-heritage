import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { OfferingsModule } from '../../offerings.module';
import { OFFERING_BID_ESCROW_QUEUE } from '../offering-bids.constants';
import { OfferingBidEscrowProcessor } from './offering-bid-escrow.processor';

/**
 * Provider-only bid-escrow worker (TOV-156), imported directly into `app.module` (the deploy/KYC-sweep
 * worker precedent) — NOT a route surface. Consumes the `offering-bid-escrow` queue and relays the
 * passkey-signed `submit_bid` via the shared `RELAYER_SERVICE` (reusing the relayer-account lock). Distinct
 * from the TOV-154 escrow-DEPLOY worker (different auth model, port, and lock account), so it is its own
 * module. Imports `OfferingsModule` for `OFFERING_BID_REPOSITORY`; stays config-free at the module level.
 */
@Module({
  imports: [
    OfferingsModule,
    RelayerModule,
    WalletsAuditModule,
    BullModule.registerQueue({ name: OFFERING_BID_ESCROW_QUEUE }),
  ],
  providers: [OfferingBidEscrowProcessor],
})
export class OfferingBidWorkerModule {}
