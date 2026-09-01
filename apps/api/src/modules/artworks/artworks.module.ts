import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Artwork } from '@modules/fractionalization/entities/artwork.entity';
import { ArtworkImage } from '@modules/fractionalization/entities/artwork-image.entity';
import { StorageModule } from '@modules/storage/storage.module';
import { ArtworksController } from './artworks.controller';
import { ArtworksService } from './artworks.service';
import { ARTWORK_READ_REPOSITORY } from './repositories/artwork-read-repository.interface';
import { ArtworkReadRepository } from './repositories/artwork-read.repository';

/**
 * Public anonymous artwork browse (TOV-189). Registers the fractionalization-owned `Artwork`/
 * `ArtworkImage` via `forFeature` DELIBERATELY (rather than importing `FractionalizationModule`, the
 * TOV-240 way) to keep the Soroban `FRACTION_FACTORY_SERVICE` + its `onApplicationBootstrap` probe out
 * of this lightweight anonymous public graph. `filesConfig` is global (`isGlobal:true`), so the service
 * injects `filesConfig.KEY` without a module import; `StorageModule` provides the `'IStorageService'` port.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Artwork, ArtworkImage]), StorageModule],
  controllers: [ArtworksController],
  providers: [
    ArtworksService,
    { provide: ARTWORK_READ_REPOSITORY, useClass: ArtworkReadRepository },
  ],
})
export class ArtworksModule {}
