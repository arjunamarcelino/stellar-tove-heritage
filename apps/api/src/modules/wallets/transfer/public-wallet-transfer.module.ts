import { Module } from '@nestjs/common';
import { WalletsModule } from '../wallets.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { WalletTransferController } from './wallet-transfer.controller';
import { WalletTransferService } from './wallet-transfer.service';

/**
 * Public passkey-signed transfer surface (TOV-22). A thin module on top of the neutral `wallets`
 * aggregate + the relayer port (the `files/` → `PublicFilesModule` precedent), served under the
 * public API prefix (`api/v1/wallet/...`). The neutral `WalletsModule` stays controller-less.
 * relayer/webauthn config is global (loaded in AppModule), so it is injected by KEY without forFeature.
 */
@Module({
  imports: [WalletsModule, RelayerModule],
  controllers: [WalletTransferController],
  providers: [WalletTransferService],
})
export class PublicWalletTransferModule {}
