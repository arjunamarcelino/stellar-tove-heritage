import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

/**
 * A supporting image for an artwork (TOV-189, FR-08.01). One row per image; the public detail read
 * (`modules/artworks`) returns them ordered by `sort_order` as signed CDN URLs. `storage_path` is a
 * Supabase storage key signed on read — never returned raw. Co-located with the `Artwork` entity (same
 * aggregate/table family); the public read model is its sole consumer.
 *
 * FK `artwork_id → artworks(id) ON DELETE CASCADE` (migration …046): images carry no independent value
 * and are fully owned by the artwork. The parent uses soft-delete, so CASCADE only fires on a hard
 * delete (test teardown); in prod, image removal is an app-level `deleted_at` write, and the read path
 * filters children by `deleted_at IS NULL`.
 *
 * NOTE for the future admin write/upload path (tracked in todo 394): CASCADE does NOT propagate a parent
 * SOFT-delete, so that path must (a) propagate an artwork soft-delete to its images, (b) reject image
 * inserts against a soft-deleted parent (the FK only checks row existence), and (c) decide whether
 * `(artwork_id, sort_order)` should be unique (today duplicate positions are tolerated; the read tiebreaks
 * on `id ASC`). None of these are reachable today — images are seed-only, and the detail read 404s on a
 * soft-deleted parent before reading images.
 */
@Entity({ name: 'artwork_images' })
@Index('IDX_artwork_images_artwork', ['artworkId', 'sortOrder'], { where: '"deleted_at" IS NULL' })
export class ArtworkImage extends BaseEntity {
  @Column({ name: 'artwork_id', type: 'uuid' })
  artworkId!: string;

  @Column({ name: 'storage_path', type: 'text' })
  storagePath!: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}
