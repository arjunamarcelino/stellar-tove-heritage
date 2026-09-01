import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { WalletsModule } from '../wallets.module';
import { WalletsAuditModule } from '../audit/wallets-audit.module';
import { FractionKycAllowlist } from './entities/fraction-kyc-allowlist.entity';
import { WalletExport } from './entities/wallet-export.entity';
import { WalletExportItem } from './entities/wallet-export-item.entity';
import { WalletRotationTransfer } from '../rotation/entities/wallet-rotation-transfer.entity';
import { KYC_ALLOWLIST_REPOSITORY } from './repositories/kyc-allowlist-repository.interface';
import { KycAllowlistRepository } from './repositories/kyc-allowlist.repository';
import { WALLET_EXPORT_REPOSITORY } from './repositories/wallet-export-repository.interface';
import { WalletExportRepository } from './repositories/wallet-export.repository';
import { KycAllowlistService } from './kyc-allowlist.service';
import { WalletExportService } from './wallet-export.service';

/**
 * Provider-only embedded-wallet **export** stack (TOV-40): the N-transfer drain orchestration + its
 * KYC-allowlist / export-tracker entities and repos, on top of the neutral `wallets` aggregate + the relayer
 * port. Owns no controller — the `me/wallets/:id/export...` HTTP routes live on the shared
 * `MeWalletsController` (`wallets/me/`), which injects the exported `WalletExportService`. Kept separate from
 * the identity surface so the two concerns evolve independently.
 *
 * The append-only audit facility (`internal_audit_log` + `AuditLogService`) is no longer owned here — it was
 * extracted into the neutral {@link WalletsAuditModule} (TOV-25 #158/#166) since it is consumed by export,
 * the me/ primary-change surface, and `WalletsService` genesis rows. This module imports it for its
 * export-lifecycle audit writes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FractionKycAllowlist, WalletExport, WalletExportItem, WalletRotationTransfer]),
    WalletsModule,
    WalletsAuditModule,
    RelayerModule,
  ],
  providers: [
    WalletExportService,
    KycAllowlistService,
    { provide: KYC_ALLOWLIST_REPOSITORY, useClass: KycAllowlistRepository },
    { provide: WALLET_EXPORT_REPOSITORY, useClass: WalletExportRepository },
  ],
  exports: [WalletExportService],
})
export class WalletExportModule {}
