import { Module } from '@nestjs/common';
import { ArtistsController } from './artists.controller';
import { ArtistsService } from './artists.service';
import { ARTIST_READ_REPOSITORY } from './repositories/artist-read-repository.interface';
import { InMemoryArtistRepository } from './repositories/in-memory-artist.repository';

@Module({
  controllers: [ArtistsController],
  providers: [
    ArtistsService,
    { provide: ARTIST_READ_REPOSITORY, useClass: InMemoryArtistRepository },
  ],
})
export class ArtistsModule {}
