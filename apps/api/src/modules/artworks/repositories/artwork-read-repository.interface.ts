export type ArtworkStatus = 'verified' | 'published';

export interface ArtworkRecord {
  id: string;
  title: string;
  year: number;
  medium: string;
  dimensions: string;
  artistHandle: string;
  artistName: string;
  primaryImageUrl: string;
  status: ArtworkStatus;
}

/** DI token for the artwork read-model repository (string-token style). */
export const ARTWORK_READ_REPOSITORY = 'IArtworkReadRepository';

/**
 * Read-only seam over the artwork browse projection (future `mv_artwork_browse`).
 * Async now so the TOV-189 TypeORM impl can `extends BaseRepository implements
 * IArtworkReadRepository` — a one-provider swap, no sync→async churn.
 */
export interface IArtworkReadRepository {
  /** `limit` bounds the read at the data layer (future TypeORM impl applies `LIMIT`). */
  findAll(limit: number): Promise<readonly ArtworkRecord[]>;
  findOneById(id: string): Promise<ArtworkRecord | null>;
}
