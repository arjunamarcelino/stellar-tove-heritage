import { Module } from '@nestjs/common';
import { ArtworksController } from './artworks.controller';
import { ArtworksService } from './artworks.service';
import { ARTWORK_READ_REPOSITORY } from './repositories/artwork-read-repository.interface';
import { InMemoryArtworkRepository } from './repositories/in-memory-artwork.repository';

@Module({
  controllers: [ArtworksController],
  providers: [
    ArtworksService,
    { provide: ARTWORK_READ_REPOSITORY, useClass: InMemoryArtworkRepository },
  ],
})
export class ArtworksModule {}
