import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { WalletsModule } from '../wallets.module';
import { WalletsAuditModule } from '../audit/wallets-audit.module';
import { WalletExportModule } from '../export/wallet-export.module';
import { WalletRotationModule } from '../rotation/wallet-rotation.module';
import { WALLET_TRUSTLINE_SERVICE } from '../wallet-trustline.service.interface';
import { SorobanWalletTrustlineService } from '../soroban-wallet-trustline.service';
import { MeWalletsService } from './me-wallets.service';
import { MeWalletsController } from './me-wallets.controller';

/**
 * Public authenticated `me/wallets` identity surface (TOV-24): list / add / remove + the user-bound SEP-10
 * challenge, served under `api/v1/me/wallets...`. The single `MeWalletsController` also carries the
 * TOV-40 export routes (`:id/export...`) — one controller keeps `DELETE :id` and `GET :id/export` under
 * NestJS's intra-controller static-before-`:param` route ordering — so this module imports the
 * provider-only {@link WalletExportModule} for its `WalletExportService`.
 *
 * Imports `AuthModule` for `Sep10Service` (acyclic — the neutral `WalletsModule` never imports auth) and
 * `IdempotencyModule` for the `Idempotency-Key` on add.
 */
@Module({
  imports: [WalletsModule, WalletsAuditModule, AuthModule, IdempotencyModule, WalletExportModule, WalletRotationModule],
  controllers: [MeWalletsController],
  providers: [
    MeWalletsService,
    { provide: WALLET_TRUSTLINE_SERVICE, useClass: SorobanWalletTrustlineService },
  ],
})
export class PublicMeWalletsModule {}
