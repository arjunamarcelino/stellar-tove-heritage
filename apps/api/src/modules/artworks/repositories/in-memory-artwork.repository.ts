import { Injectable } from '@nestjs/common';
import type {
  ArtworkRecord,
  IArtworkReadRepository,
} from './artwork-read-repository.interface';

/**
 * Deterministic, ordered fixtures standing in for the future artwork read model.
 * Every `status` is anonymous-visible; each `artistHandle` resolves to an artist
 * fixture. Visibility scope lives in the repository (TOV-81 becomes one predicate).
 */
export const ARTWORK_FIXTURES = [
  {
    id: 'aw-001',
    title: 'Northern Lights',
    year: 1998,
    medium: 'Oil on canvas',
    dimensions: '80x120 cm',
    artistHandle: 'sophie-tove',
    artistName: 'Sophie Tove',
    primaryImageUrl: 'https://cdn.tove.test/aw-001.jpg',
    status: 'verified',
  },
  {
    id: 'aw-002',
    title: 'Fjord Study',
    year: 2005,
    medium: 'Watercolor',
    dimensions: '30x40 cm',
    artistHandle: 'ari-lund',
    artistName: 'Ari Lund',
    primaryImageUrl: 'https://cdn.tove.test/aw-002.jpg',
    status: 'published',
  },
  {
    id: 'aw-003',
    title: 'Midnight Sun',
    year: 2012,
    medium: 'Acrylic',
    dimensions: '100x100 cm',
    artistHandle: 'sophie-tove',
    artistName: 'Sophie Tove',
    primaryImageUrl: 'https://cdn.tove.test/aw-003.jpg',
    status: 'verified',
  },
] as const satisfies readonly ArtworkRecord[];

@Injectable()
export class InMemoryArtworkRepository implements IArtworkReadRepository {
  findAll(limit: number): Promise<readonly ArtworkRecord[]> {
    return Promise.resolve(ARTWORK_FIXTURES.slice(0, limit));
  }

  findOneById(id: string): Promise<ArtworkRecord | null> {
    return Promise.resolve(ARTWORK_FIXTURES.find((record) => record.id === id) ?? null);
  }
}
