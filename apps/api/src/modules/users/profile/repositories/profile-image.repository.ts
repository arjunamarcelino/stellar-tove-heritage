import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, LessThan } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { User } from '../../entities/user.entity';
import { ProfileImage } from '../entities/profile-image.entity';
import { IProfileImageRepository } from './profile-image-repository.interface';
import { ProfileImageDerivatives } from '../constants/profile-image.constants';

@Injectable()
export class ProfileImageRepository
  extends BaseRepository<ProfileImage>
  implements IProfileImageRepository
{
  constructor(dataSource: DataSource) {
    super(ProfileImage, dataSource);
  }

  createPending(userId: string, imageId: string, sourcePath: string): Promise<ProfileImage> {
    const row = this.repository.create({
      id: imageId,
      userId,
      sourcePath,
      status: 'pending',
      derivatives: {},
    });
    return this.repository.save(row);
  }

  findOwned(id: string, userId: string): Promise<ProfileImage | null> {
    // TypeORM auto-appends `deleted_at IS NULL`.
    return this.repository.findOne({ where: { id, userId } });
  }

  findById(id: string): Promise<ProfileImage | null> {
    return this.repository.findOne({ where: { id } });
  }

  countNonTerminalByUser(userId: string): Promise<number> {
    return this.repository.count({ where: { userId, status: In(['pending', 'processing']) } });
  }

  async claimForProcessing(id: string, userId: string): Promise<boolean> {
    // Atomic conditional transition — the whole double-commit guard. UPDATE does NOT auto-scope soft
    // deletes, so `deleted_at IS NULL` is explicit. 0 affected ⇒ another commit won (or the row is gone).
    const res = await this.repository
      .createQueryBuilder()
      .update(ProfileImage)
      .set({ status: 'processing' })
      .where('id = :id AND user_id = :userId AND status = :pending AND deleted_at IS NULL', {
        id,
        userId,
        pending: 'pending',
      })
      .execute();
    return (res.affected ?? 0) > 0;
  }

  async markReady(id: string, derivatives: ProfileImageDerivatives): Promise<void> {
    // Guarded: only a live `processing` row → `ready`. A no-op if a concurrent commit/reconcile already
    // moved it, so a losing worker can never resurrect a `failed`/soft-deleted row to `ready`.
    await this.repository.update(
      { id, status: 'processing', deletedAt: IsNull() },
      { status: 'ready', derivatives },
    );
  }

  async markFailed(id: string): Promise<void> {
    // Guarded: only a live `pending`/`processing` row → `failed`. Prevents a losing concurrent commit from
    // clobbering an already-`ready` (possibly activated) avatar to `failed` (which the reaper would delete).
    await this.repository.update(
      { id, status: In(['pending', 'processing']), deletedAt: IsNull() },
      { status: 'failed' },
    );
  }

  async softDeleteOwned(id: string, userId: string): Promise<boolean> {
    const res = await this.repository.softDelete({ id, userId });
    return (res.affected ?? 0) > 0;
  }

  async softDeleteAndClearAvatar(userId: string, imageId: string): Promise<boolean> {
    return this.runInTransaction(async (manager) => {
      const res = await manager.softDelete(ProfileImage, { id: imageId, userId });
      if ((res.affected ?? 0) === 0) return false;
      // Null the FK only if this image is the active avatar (conditional criteria → no-op otherwise).
      await manager.update(User, { id: userId, profileImageId: imageId }, { profileImageId: null });
      return true;
    });
  }

  findStuckProcessing(olderThan: Date, limit: number): Promise<ProfileImage[]> {
    return this.repository.find({
      where: { status: 'processing', updatedAt: LessThan(olderThan) },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
  }

  async findReapable(cutoff: Date, limit: number): Promise<ProfileImage[]> {
    // Two INDEX-SERVED queries instead of one OR (the partial index `WHERE deleted_at IS NULL` can't serve a
    // `deleted_at IS NOT NULL` branch → Seq Scan). Both exclude the active avatar (NOT EXISTS on users).
    const notReferenced = 'NOT EXISTS (SELECT 1 FROM users u WHERE u.profile_image_id = pi.id AND u.deleted_at IS NULL)';

    // (a) stale-terminal / abandoned live rows — TypeORM auto-scopes `deleted_at IS NULL` → uses
    //     IDX_profile_images_reap. 'ready' included: an unreferenced never-activated/superseded ready upload.
    const stale = await this.repository
      .createQueryBuilder('pi')
      .where(`pi.status IN (:...reapable) AND pi.created_at < :cutoff AND ${notReferenced}`, {
        reapable: ['pending', 'failed', 'ready'],
        cutoff,
      })
      .orderBy('pi.created_at', 'ASC')
      .take(limit)
      .getMany();

    const remaining = limit - stale.length;
    if (remaining <= 0) return stale;

    // (b) soft-deleted rows — uses IDX_profile_images_reap_deleted (migration 049).
    const deleted = await this.repository
      .createQueryBuilder('pi')
      .withDeleted()
      .where(`pi.deleted_at IS NOT NULL AND ${notReferenced}`)
      .orderBy('pi.created_at', 'ASC')
      .take(remaining)
      .getMany();

    return [...stale, ...deleted];
  }

  async hardDelete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  findAllForUser(userId: string): Promise<ProfileImage[]> {
    return this.repository.find({ where: { userId } });
  }

  async softDeleteAllForUser(userId: string): Promise<void> {
    await this.repository.softDelete({ userId });
  }
}
