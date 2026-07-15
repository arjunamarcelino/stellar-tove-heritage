/**
 * Read seam for the artists browse surface. Backed by an in-memory provider for
 * TOV-19; a TypeORM implementation lands with the artist schema (TOV-194) and
 * rebinds the {@link ARTIST_READ_REPOSITORY} token — controllers, services, and
 * DTOs stay unchanged. Async now so that swap is signature-compatible.
 */
export interface ArtistRecord {
  handle: string;
  name: string;
}

export const ARTIST_READ_REPOSITORY = 'IArtistReadRepository';

export interface IArtistReadRepository {
  /** `limit` bounds the read at the data layer (future TypeORM impl applies `LIMIT`). */
  findAll(limit: number): Promise<readonly ArtistRecord[]>;
  findByHandle(handle: string): Promise<ArtistRecord | null>;
}
