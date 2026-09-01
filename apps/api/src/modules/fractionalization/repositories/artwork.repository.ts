import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Artwork, ArtworkStatus } from '../entities/artwork.entity';
import { IArtworkRepository } from './artwork-repository.interface';

@Injectable()
export class ArtworkRepository extends BaseRepository<Artwork> implements IArtworkRepository {
  constructor(dataSource: DataSource) {
    super(Artwork, dataSource);
  }

  async casStatus(
    manager: EntityManager,
    id: string,
    from: ArtworkStatus,
    to: ArtworkStatus,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Artwork)
      .set({ status: to, updatedAt: () => 'now()' })
      .where('id = :id AND status = :from AND deleted_at IS NULL', { id, from })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  // Narrowed to live rows so a soft-deleted artwork is never fractionalizable.
  override async findOneById(id: string): Promise<Artwork | null> {
    return this.repository.findOne({ where: { id, deletedAt: IsNull() } });
  }

  async findByIds(ids: string[]): Promise<Artwork[]> {
    if (ids.length === 0) return [];
    return this.repository.find({ where: { id: In(ids), deletedAt: IsNull() } });
  }
}
