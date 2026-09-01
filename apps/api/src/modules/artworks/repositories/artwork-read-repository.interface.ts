import type { PublicArtworkStatus } from '../constants/artwork-visibility.constant';

export type { PublicArtworkStatus };

/**
 * List (browse) projection — base fields only. Nullable to match the real `artworks` table
 * (`year/medium/dimensions/artist_name/artist_handle/primary_image_url` are all nullable). `status` is
 * narrowed to the anonymous-visible subset (the read filter guarantees it). `primaryImageUrl` is a
 * passthrough absolute CDN URL (the list path never signs).
 */
export interface ArtworkRecord {
  id: string;
  title: string;
  year: number | null;
  medium: string | null;
  dimensions: string | null;
  artistHandle: string | null;
  artistName: string | null;
  primaryImageUrl: string | null;
  status: PublicArtworkStatus;
}

/**
 * Detail projection — the list record plus the fields only the detail surface needs. `coaStoragePath`
 * and `supportingImages` are RAW Supabase storage paths (pre-ordered `sort_order ASC, id ASC`); the
 * service signs them into 1h URLs. They are never returned raw in the HTTP response.
 */
export interface ArtworkDetailRecord extends ArtworkRecord {
  custodian: string | null;
  coaStoragePath: string | null;
  supportingImages: string[];
}

/** DI token for the artwork read-model repository (string-token style). */
export const ARTWORK_READ_REPOSITORY = 'IArtworkReadRepository';

/**
 * Read-only seam over the artwork browse projection (TOV-189). The TypeORM impl COMPOSES a `DataSource`
 * (two `Repository<T>` handles) rather than extending `BaseRepository` — a projection-returning seam is
 * incompatible with the entity-returning base signatures.
 */
export interface IArtworkReadRepository {
  /** `limit` bounds the read at the data layer (TypeORM applies `LIMIT`). Visible statuses only. */
  findAll(limit: number): Promise<readonly ArtworkRecord[]>;
  /** Detail projection incl. supporting images + COA path. Visible statuses only; `null` on any miss. */
  findOneById(id: string): Promise<ArtworkDetailRecord | null>;
}
