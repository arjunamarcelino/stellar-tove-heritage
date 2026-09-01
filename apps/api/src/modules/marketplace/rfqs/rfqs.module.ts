import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rfq } from './entities/rfq.entity';
import { RFQ_REPOSITORY } from './repositories/rfq-repository.interface';
import { RfqRepository } from './repositories/rfq.repository';

/**
 * Neutral marketplace-RFQ domain (TOV-172, FR-06.01): the `rfqs` entity/repo and its port. Provider-only,
 * config-free — deliberately does NOT import the config/network-dependent Relayer/Wallets modules (those
 * live in the public surface module, their only consumer), so this module stays importable by the
 * fixed-config integration harness and by a future backoffice/FR-06.02 surface. Binds and exports
 * `RFQ_REPOSITORY` + `TypeOrmModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Rfq])],
  providers: [{ provide: RFQ_REPOSITORY, useClass: RfqRepository }],
  exports: [RFQ_REPOSITORY, TypeOrmModule],
})
export class RfqsModule {}
