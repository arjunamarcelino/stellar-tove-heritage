import { Injectable } from '@nestjs/common';
import type {
  ArtistRecord,
  IArtistReadRepository,
} from './artist-read-repository.interface';

/**
 * Deterministic, ordered artist fixtures. Handles are referenced by artwork
 * fixtures; keep the order stable so list responses and tests are predictable.
 */
export const ARTIST_FIXTURES = [
  { handle: 'sophie-tove', name: 'Sophie Tove' },
  { handle: 'ari-lund', name: 'Ari Lund' },
] as const satisfies readonly ArtistRecord[];

@Injectable()
export class InMemoryArtistRepository implements IArtistReadRepository {
  findAll(limit: number): Promise<readonly ArtistRecord[]> {
    return Promise.resolve(ARTIST_FIXTURES.slice(0, limit));
  }

  findByHandle(handle: string): Promise<ArtistRecord | null> {
    const match = ARTIST_FIXTURES.find((artist) => artist.handle === handle);
    return Promise.resolve(match ?? null);
  }
}
