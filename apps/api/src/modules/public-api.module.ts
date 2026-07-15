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
import { CollectorsModule } from '@modules/collectors/collectors.module';

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
  CollectorsModule,
] as const;

@Module({
  imports: [
    ...PUBLIC_MODULES,
    RouterModule.register([{ path: PUBLIC_API_PREFIX, children: [...PUBLIC_MODULES] }]),
  ],
})
export class PublicApiModule {}
