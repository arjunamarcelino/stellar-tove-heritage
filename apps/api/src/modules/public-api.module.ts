import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { PUBLIC_API_PREFIX } from '@common/constants/api-prefix.constant';
import { AuthModule } from '@modules/auth/auth.module';
import { HealthModule } from '@modules/health/health.module';
import { UserStagesModule } from '@modules/stages/stages.module';
import { UserSubmissionsModule } from '@modules/submissions/submissions.module';
import { PublicFilesModule } from '@modules/files/public-files.module';
import { ArtworksModule } from '@modules/artworks/artworks.module';
import { ArtistsModule } from '@modules/artists/artists.module';
import { PublicWalletTransferModule } from '@modules/wallets/transfer/public-wallet-transfer.module';
import { PublicMeWalletsModule } from '@modules/wallets/me/public-me-wallets.module';
import { PublicHandleModule } from '@modules/users/handle/public-handle.module';
import { PublicProfileModule } from '@modules/users/profile/public-profile.module';
import { PublicBeneficiaryModule } from '@modules/users/beneficiary/public-beneficiary.module';
import { CollectorsModule } from '@modules/collectors/collectors.module';
import { PublicKycModule } from '@modules/kyc/kyc.module';
import { PublicMeHoldingsModule } from '@modules/fractionalization/me/public-me-holdings.module';
import { PublicOfferingBidsModule } from '@modules/offerings/bids/public-offering-bids.module';
import { PublicRfqsModule } from '@modules/marketplace/rfqs/public-rfqs.module';
import { PublicRfqDetailModule } from '@modules/marketplace/rfqs/detail/public-rfq-detail.module';
import { PublicQuotesModule } from '@modules/marketplace/quotes/public-quotes.module';
import { PublicSettlementModule } from '@modules/marketplace/settlement/accept/public-settlement.module';
import { PublicMeNotificationsModule } from '@modules/marketplace/notifications/public-me-notifications.module';
import { PublicTimelineModule } from '@modules/timeline/public-timeline.module';

/**
 * Leaf modules whose controllers are served under the public prefix
 * (`api/v1/...`). Exported so Swagger's `include` can build the public-only
 * document from the same list that feeds `RouterModule`.
 */
export const PUBLIC_MODULES = [
  AuthModule,
  HealthModule,
  UserStagesModule,
  UserSubmissionsModule,
  PublicFilesModule,
  ArtworksModule,
  ArtistsModule,
  PublicWalletTransferModule,
  PublicMeWalletsModule,
  PublicHandleModule,
  PublicProfileModule,
  PublicBeneficiaryModule,
  CollectorsModule,
  PublicKycModule,
  PublicMeHoldingsModule,
  PublicOfferingBidsModule,
  PublicRfqsModule,
  PublicRfqDetailModule,
  PublicQuotesModule,
  PublicSettlementModule,
  PublicMeNotificationsModule,
  PublicTimelineModule,
] as const;

@Module({
  imports: [
    ...PUBLIC_MODULES,
    RouterModule.register([{ path: PUBLIC_API_PREFIX, children: [...PUBLIC_MODULES] }]),
  ],
})
export class PublicApiModule {}
