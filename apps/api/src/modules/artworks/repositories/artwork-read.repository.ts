import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Artwork } from '@modules/fractionalization/entities/artwork.entity';
import { ArtworkImage } from '@modules/fractionalization/entities/artwork-image.entity';
import { assertVisibleStatus, PUBLIC_VISIBLE_STATUSES } from '../constants/artwork-visibility.constant';
import type {
  ArtworkDetailRecord,
  ArtworkRecord,
  IArtworkReadRepository,
} from './artwork-read-repository.interface';

/** Bound the detail's supporting-image fan-out at the data layer (each becomes one signing round-trip). */
const MAX_SUPPORTING_IMAGES = 20;

/**
 * TypeORM-backed public artwork read model (TOV-189). COMPOSES the `DataSource` (two `Repository<T>`
 * handles) instead of extending `BaseRepository<Artwork>` — the projection return types
 * (`ArtworkRecord`/`ArtworkDetailRecord`) are incompatible with the base's entity-returning
 * `findOneById`/`findAll`. Applies the single-sourced visibility filter + soft-delete filter; returns
 * RAW storage paths (the service signs them). Both reads complete BEFORE the service begins signing, so
 * no pooled DB connection is held across the Supabase round-trips.
 *
 * READ-ONLY by contract: this repo must never write to `artworks`/`artwork_images`. All mutations go
 * through the fractionalization domain (the `verified → fractionalizing → fractionalized` status CAS);
 * the composed `getRepository` handles are write-capable, so this is a convention, not a type guarantee.
 */
@Injectable()
export class ArtworkReadRepository implements IArtworkReadRepository {
  private readonly artworks: Repository<Artwork>;
  private readonly images: Repository<ArtworkImage>;

  constructor(dataSource: DataSource) {
    this.artworks = dataSource.getRepository(Artwork);
    this.images = dataSource.getRepository(ArtworkImage);
  }

  async findAll(limit: number): Promise<readonly ArtworkRecord[]> {
    const rows = await this.artworks.find({
      where: { status: In([...PUBLIC_VISIBLE_STATUSES]), deletedAt: IsNull() },
      order: { createdAt: 'DESC', id: 'ASC' }, // stable ordering (id tiebreak on same-timestamp rows)
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async findOneById(id: string): Promise<ArtworkDetailRecord | null> {
    // Two non-transactional reads (artwork, then its images) — deliberately NOT wrapped in a txn so no
    // pooled connection is held across the Supabase signing. Accepted trade-off: a concurrent image
    // insert/soft-delete between the two SELECTs yields a slightly stale image set (cosmetic only; no
    // integrity/money exposure).
    const artwork = await this.artworks.findOne({
      where: { id, status: In([...PUBLIC_VISIBLE_STATUSES]), deletedAt: IsNull() },
    });
    if (!artwork) return null;

    const images = await this.images.find({
      where: { artworkId: id, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', id: 'ASC' },
      take: MAX_SUPPORTING_IMAGES,
    });

    return {
      ...this.toRecord(artwork),
      custodian: artwork.custodian,
      coaStoragePath: artwork.coaStoragePath,
      supportingImages: images.map((image) => image.storagePath),
    };
  }

  /** Entity → list projection, field-by-field (no `Object.assign`); status via the drift guard. */
  private toRecord(artwork: Artwork): ArtworkRecord {
    return {
      id: artwork.id,
      title: artwork.title,
      year: artwork.year,
      medium: artwork.medium,
      dimensions: artwork.dimensions,
      artistHandle: artwork.artistHandle,
      artistName: artwork.artistName,
      primaryImageUrl: artwork.primaryImageUrl,
      status: assertVisibleStatus(artwork.status),
    };
  }
}
