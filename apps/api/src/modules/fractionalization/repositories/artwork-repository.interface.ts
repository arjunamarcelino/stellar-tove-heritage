import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { Artwork, ArtworkStatus } from '../entities/artwork.entity';

export const ARTWORK_REPOSITORY = 'IArtworkRepository';

/**
 * Write seam over the `artworks` table for the fractionalize path (TOV-233). Kept separate from the
 * narrow public `IArtworkReadRepository` (browse projection) so write concerns never widen the read model.
 */
export interface IArtworkRepository extends IBaseRepository<Artwork> {
  /**
   * Single-writer CAS on `artworks.status` inside the caller's transaction. Returns `true` iff a row moved
   * `from → to` (0 rows ⇒ lost the race / wrong state). Always stamps `updated_at` (raw update bypasses
   * `@UpdateDateColumn`).
   */
  casStatus(
    manager: EntityManager,
    id: string,
    from: ArtworkStatus,
    to: ArtworkStatus,
  ): Promise<boolean>;

  /** Live artworks for a set of ids — batch metadata join for the holdings read (TOV-237). */
  findByIds(ids: string[]): Promise<Artwork[]>;
}
