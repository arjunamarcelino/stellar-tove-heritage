import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { KycAllowlistModule } from '@modules/kyc-allowlist/kyc-allowlist.module';
import { BackofficeKycAllowlistController } from './backoffice-kyc-allowlist.controller';
import { BackofficeKycAllowlistService } from './backoffice-kyc-allowlist.service';

/**
 * Backoffice KYC allowlist surface (TOV-235): HTTP producer over the neutral `KycAllowlistModule` port.
 * Reuses the shared `IdempotencyStore` and the neutral `WalletsAuditModule` (audit `kyc.allowlist.processed`).
 * Imports `WalletsModule` for the TOV-243 advisory BYOW-binding check on external G-address adds.
 */
@Module({
  imports: [JwtModule.register({}), KycAllowlistModule, IdempotencyModule, WalletsAuditModule, WalletsModule],
  controllers: [BackofficeKycAllowlistController],
  providers: [BackofficeGuard, BackofficeKycAllowlistService],
})
export class BackofficeKycAllowlistModule {}
