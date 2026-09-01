import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { Artwork } from './entities/artwork.entity';
import { FractionContract } from './entities/fraction-contract.entity';
import { ARTWORK_REPOSITORY } from './repositories/artwork-repository.interface';
import { ArtworkRepository } from './repositories/artwork.repository';
import { FRACTION_CONTRACT_REPOSITORY } from './repositories/fraction-contract-repository.interface';
import { FractionContractRepository } from './repositories/fraction-contract.repository';
import { FRACTION_FACTORY_SERVICE } from './fraction-factory.service.interface';
import { SorobanFractionFactoryService } from './soroban-fraction-factory.service';

/**
 * Neutral fractionalization domain (TOV-233): the `artworks` + `fraction_contracts` entities/repos and
 * the `FRACTION_FACTORY_SERVICE` port. Provider-only (no route surface) — imported by the backoffice
 * producer (endpoint) and the provider-only deploy worker. Imports `RelayerModule` for the shared
 * `RELAYER_ACCOUNT_LOCK`. Tests override `FRACTION_FACTORY_SERVICE` with an in-memory fake.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Artwork, FractionContract]), RelayerModule],
  providers: [
    { provide: ARTWORK_REPOSITORY, useClass: ArtworkRepository },
    { provide: FRACTION_CONTRACT_REPOSITORY, useClass: FractionContractRepository },
    { provide: FRACTION_FACTORY_SERVICE, useClass: SorobanFractionFactoryService },
  ],
  exports: [ARTWORK_REPOSITORY, FRACTION_CONTRACT_REPOSITORY, FRACTION_FACTORY_SERVICE, TypeOrmModule],
})
export class FractionalizationModule {}
