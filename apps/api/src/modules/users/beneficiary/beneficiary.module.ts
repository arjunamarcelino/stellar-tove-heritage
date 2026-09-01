import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Beneficiary } from './entities/beneficiary.entity';
import { BeneficiaryRepository } from './repositories/beneficiary.repository';
import { BENEFICIARY_REPOSITORY } from './repositories/beneficiary-repository.interface';

/**
 * Neutral beneficiary domain (TOV-31): owns the `Beneficiary` entity + repository, no controller. Consumed
 * by both the public `me` surface ({@link PublicBeneficiaryModule}) and the account-erasure hook
 * ({@link BeneficiaryErasureModule}) — the two-surface split that mirrors `profile`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Beneficiary])],
  providers: [{ provide: BENEFICIARY_REPOSITORY, useClass: BeneficiaryRepository }],
  exports: [BENEFICIARY_REPOSITORY],
})
export class BeneficiaryModule {}
