import { Module } from '@nestjs/common';
import { BeneficiaryModule } from './beneficiary.module';
import { BeneficiaryErasureService } from './beneficiary-erasure.service';

/**
 * Neutral module exposing {@link BeneficiaryErasureService} (TOV-31 C1). Imported by the backoffice users
 * surface (the admin delete path) so the neutral BeneficiaryModule stays free of any HTTP surface — mirrors
 * `ProfileErasureModule`.
 */
@Module({
  imports: [BeneficiaryModule],
  providers: [BeneficiaryErasureService],
  exports: [BeneficiaryErasureService],
})
export class BeneficiaryErasureModule {}
