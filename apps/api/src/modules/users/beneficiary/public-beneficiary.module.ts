import { Module } from '@nestjs/common';
import { UsersModule } from '../users.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { BeneficiaryModule } from './beneficiary.module';
import { BeneficiaryService } from './beneficiary.service';
import { MeBeneficiaryController } from './me-beneficiary.controller';

/**
 * Public beneficiary surface (TOV-31, FR-01.10), added to `PUBLIC_MODULES`. The authenticated
 * `me/beneficiary` controller layered on the neutral {@link BeneficiaryModule}; imports `UsersModule` for
 * the projected `findKycStatusByUserId` (notice) and `WalletsAuditModule` for the in-txn audit write.
 */
@Module({
  imports: [BeneficiaryModule, UsersModule, WalletsAuditModule],
  controllers: [MeBeneficiaryController],
  providers: [BeneficiaryService],
})
export class PublicBeneficiaryModule {}
