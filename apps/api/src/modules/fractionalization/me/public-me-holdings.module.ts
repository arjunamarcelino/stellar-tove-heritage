import { Module } from '@nestjs/common';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { FractionalizationModule } from '../fractionalization.module';
import { MeHoldingsController } from './me-holdings.controller';
import { MeHoldingsService } from './me-holdings.service';
import { HoldingsCache } from './holdings-cache';
import { FRACTION_READ_SERVICE } from '../fraction-read.service.interface';
import { SorobanFractionReadService } from '../soroban-fraction-read.service';

/**
 * Public authenticated `me/holdings` surface (TOV-237, FR-04.MVP.04), layered on the neutral
 * fractionalization domain (mirrors `wallets/me/`, `kyc/`, `users/handle/`). Imports
 * `FractionalizationModule` for the artwork + fraction-contract repos and `WalletsModule` for
 * `WalletsService.resolvePrimarySettlementAddress`. Added to `PUBLIC_MODULES`. Tests override
 * `FRACTION_READ_SERVICE` with an in-memory fake.
 */
@Module({
  imports: [FractionalizationModule, WalletsModule],
  controllers: [MeHoldingsController],
  providers: [
    MeHoldingsService,
    HoldingsCache,
    { provide: FRACTION_READ_SERVICE, useClass: SorobanFractionReadService },
  ],
})
export class PublicMeHoldingsModule {}
