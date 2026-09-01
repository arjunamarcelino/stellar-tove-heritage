import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { BACKOFFICE_API_PREFIX } from '@common/constants/api-prefix.constant';
import { AdminsModule } from './admins/admins.module';
import { BackofficeAuthModule } from './auth/backoffice-auth.module';
import { BackofficeDashboardModule } from './dashboard/dashboard.module';
import { BackofficeFilesModule } from './files/backoffice-files.module';
import { BackofficeStagesModule } from './stages/stages.module';
import { BackofficeMissionsModule } from './missions/missions.module';
import { BackofficeSubmissionsModule } from './submissions/submissions.module';
import { BackofficeUsersModule } from './users/backoffice-users.module';
import { BackofficeArtworksModule } from './artworks/backoffice-artworks.module';
import { BackofficeOfferingsModule } from './offerings/backoffice-offerings.module';
import { BackofficeKycAllowlistModule } from './kyc-allowlist/backoffice-kyc-allowlist.module';

/**
 * Leaf modules whose controllers are served under the backoffice prefix
 * (`api/backoffice/v1/...`). Exported so Swagger's `include` can build the
 * backoffice-only document from the same list that feeds `RouterModule`.
 */
export const BACKOFFICE_MODULES = [
  AdminsModule,
  BackofficeAuthModule,
  BackofficeDashboardModule,
  BackofficeFilesModule,
  BackofficeStagesModule,
  BackofficeMissionsModule,
  BackofficeSubmissionsModule,
  BackofficeUsersModule,
  BackofficeArtworksModule,
  BackofficeOfferingsModule,
  BackofficeKycAllowlistModule,
] as const;

@Module({
  imports: [
    ...BACKOFFICE_MODULES,
    RouterModule.register([{ path: BACKOFFICE_API_PREFIX, children: [...BACKOFFICE_MODULES] }]),
  ],
})
export class BackofficeModule {}
