import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '@modules/users/users.module';
import { Wallet } from './entities/wallet.entity';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { WalletRepository } from './repositories/wallet.repository';
import { WALLET_REPOSITORY } from './repositories/wallet-repository.interface';
import { PasskeyCredentialRepository } from './repositories/passkey-credential.repository';
import { PASSKEY_CREDENTIAL_REPOSITORY } from './repositories/passkey-credential-repository.interface';
import { WalletsService } from './wallets.service';
import { WalletsAuditModule } from './audit/wallets-audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, PasskeyCredential]), UsersModule, WalletsAuditModule],
  providers: [
    WalletsService,
    { provide: WALLET_REPOSITORY, useClass: WalletRepository },
    { provide: PASSKEY_CREDENTIAL_REPOSITORY, useClass: PasskeyCredentialRepository },
  ],
  exports: [WalletsService],
})
export class WalletsModule {}
