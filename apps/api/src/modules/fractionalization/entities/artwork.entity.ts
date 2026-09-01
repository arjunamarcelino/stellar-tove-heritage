import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import type { ArtworkStatus } from '../constants/artwork-status.constant';

/**
 * Internal artwork lifecycle state (TOV-233). This column carries all four states; the public browse
 * (`modules/artworks`) exposes only the anonymous-visible subset `verified | fractionalized`
 * (`PUBLIC_VISIBLE_STATUSES`, TOV-189). `verified` is the only fractionalizable state. The tuple +
 * derived type live in `../constants/artwork-status.constant` (single source of truth); re-exported
 * here for back-compat.
 */
export type { ArtworkStatus };

/**
 * Persisted artwork source-of-truth for the fractionalize path (TOV-233). Since TOV-189 the public
 * anonymous browse (`modules/artworks`) reads this table directly (DB-backed, no more in-memory mock).
 * Here `status` is the CAS target (`verified → fractionalizing → fractionalized`) and `artist_user_id`
 * resolves the artist's primary settlement wallet at request time.
 */
@Entity({ name: 'artworks' })
export class Artwork extends BaseEntity {
  @Index('IDX_artworks_status', { where: '"deleted_at" IS NULL' })
  @Column({ type: 'varchar', length: 16, default: 'verified' })
  status!: ArtworkStatus;

  @Column({ name: 'artist_user_id', type: 'uuid' })
  artistUserId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'int', nullable: true })
  year!: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  medium!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  dimensions!: string | null;

  @Column({ name: 'artist_name', type: 'varchar', length: 200, nullable: true })
  artistName!: string | null;

  @Column({ name: 'artist_handle', type: 'varchar', length: 120, nullable: true })
  artistHandle!: string | null;

  @Column({ name: 'primary_image_url', type: 'text', nullable: true })
  primaryImageUrl!: string | null;

  /** Public display label for the current custodian (TOV-189). NOT for internal notes — surfaced anonymously. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  custodian!: string | null;

  /** Storage path to the Certificate of Authenticity (TOV-189); signed on read, never returned raw. */
  @Column({ name: 'coa_storage_path', type: 'text', nullable: true })
  coaStoragePath!: string | null;
}
