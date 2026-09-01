import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { KycAllowlistModule } from '@modules/kyc-allowlist/kyc-allowlist.module';
import { FRACTION_READ_SERVICE } from '@modules/fractionalization/fraction-read.service.interface';
import { SorobanFractionReadService } from '@modules/fractionalization/soroban-fraction-read.service';
import { FRACTION_CONTRACT_REPOSITORY } from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { FractionContractRepository } from '@modules/fractionalization/repositories/fraction-contract.repository';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { WalletsModule } from '../wallets.module';
import { WalletsAuditModule } from '../audit/wallets-audit.module';
import { WalletExport } from '../export/entities/wallet-export.entity';
import { WalletRotationTransfer } from './entities/wallet-rotation-transfer.entity';
import { WalletRotationTransferItem } from './entities/wallet-rotation-transfer-item.entity';
import { RegistryEvent } from './entities/registry-event.entity';
import { WALLET_ROTATION_REPOSITORY } from './repositories/wallet-rotation-repository.interface';
import { WalletRotationRepository } from './repositories/wallet-rotation.repository';
import { REGISTRY_EVENT_REPOSITORY } from './repositories/registry-event-repository.interface';
import { RegistryEventRepository } from './repositories/registry-event.repository';
import { WalletRotationService } from './wallet-rotation.service';

/**
 * Provider-only wallet-**rotation** stack (TOV-33): the holdings-transfer orchestration + its rotation
 * tracker / append-only registry entities and repos, on top of the neutral `wallets` aggregate + the relayer
 * / fraction-read / on-chain KYC-allowlist ports. Owns no controller — the `me/wallets/:id/rotate-transfer...`
 * routes live on the shared `MeWalletsController` (`wallets/me/`), which injects the exported
 * `WalletRotationService` (mirrors how `WalletExportModule` is wired).
 *
 * Binds `FRACTION_READ_SERVICE` + `FRACTION_CONTRACT_REPOSITORY` DIRECTLY (via `forFeature` + local providers)
 * rather than importing `FractionalizationModule` — the reason is **dependency-surface minimization**: it avoids
 * pulling `FRACTION_FACTORY_SERVICE` / `ARTWORK_REPOSITORY` (and the factory bootstrap probe) into this graph,
 * following the `artworks/` precedent. (Note: `RelayerModule`/`KycAllowlistModule`, imported here, DO register
 * their own app-wide `OnApplicationBootstrap` singletons — those run regardless, so this wiring doesn't and
 * can't "suppress a bootstrap probe"; it only trims the injected surface.) `WalletExport` is registered so the
 * service can query the active-export cross-feature conflict guard at the table level (no module cycle).
 * Imports `KycAllowlistModule` for the authoritative on-chain `is_allowed` destination pre-flight.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WalletRotationTransfer,
      WalletRotationTransferItem,
      RegistryEvent,
      FractionContract,
      WalletExport,
    ]),
    WalletsModule,
    WalletsAuditModule,
    RelayerModule,
    KycAllowlistModule,
  ],
  providers: [
    WalletRotationService,
    { provide: WALLET_ROTATION_REPOSITORY, useClass: WalletRotationRepository },
    { provide: REGISTRY_EVENT_REPOSITORY, useClass: RegistryEventRepository },
    { provide: FRACTION_READ_SERVICE, useClass: SorobanFractionReadService },
    { provide: FRACTION_CONTRACT_REPOSITORY, useClass: FractionContractRepository },
  ],
  exports: [WalletRotationService],
})
export class WalletRotationModule {}
