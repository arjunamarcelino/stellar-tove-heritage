import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Beneficiary } from '../entities/beneficiary.entity';
import { BeneficiaryWriteFields, IBeneficiaryRepository } from './beneficiary-repository.interface';

@Injectable()
export class BeneficiaryRepository
  extends BaseRepository<Beneficiary>
  implements IBeneficiaryRepository
{
  constructor(dataSource: DataSource) {
    super(Beneficiary, dataSource);
  }

  private repo(manager?: EntityManager) {
    return manager ? manager.getRepository(Beneficiary) : this.repository;
  }

  findByUserId(userId: string, manager?: EntityManager): Promise<Beneficiary | null> {
    // TypeORM auto-appends `deleted_at IS NULL`.
    return this.repo(manager).findOne({ where: { userId } });
  }

  createForUser(
    userId: string,
    data: BeneficiaryWriteFields,
    manager: EntityManager,
  ): Promise<Beneficiary> {
    const repo = this.repo(manager);
    const row = repo.create({ userId, ...data });
    return repo.save(row);
  }

  async applyUpdate(
    id: string,
    data: BeneficiaryWriteFields,
    manager: EntityManager,
  ): Promise<Beneficiary | null> {
    const repo = this.repo(manager);
    // UPDATE does NOT auto-scope soft deletes, so `deletedAt: IsNull()` is explicit — 0 affected means a
    // concurrent (hard) delete removed the row; the caller re-branches to insert.
    const res = await repo.update({ id, deletedAt: IsNull() }, data);
    if ((res.affected ?? 0) === 0) return null;
    return repo.findOne({ where: { id } });
  }

  async deleteByUserId(userId: string, manager?: EntityManager): Promise<string | null> {
    // Atomic hard-delete via a single DELETE … RETURNING id (physically purges the third-party PII).
    // One statement — not find-then-delete — so a concurrent delete can't return an id for 0 removed
    // rows and cause a spurious second `beneficiary.removed` audit row (issue 422).
    const res = await this.repo(manager)
      .createQueryBuilder()
      .delete()
      .from(Beneficiary)
      .where('user_id = :userId AND deleted_at IS NULL', { userId })
      .returning('id')
      .execute();
    const rows = res.raw as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  async deleteOrphansOfDeletedUsers(): Promise<number> {
    // Bulk hard-delete rows whose owning user is soft-deleted. DELETE is not affected by the
    // BEFORE-UPDATE hard-delete guard trigger. Non-transactional (backstop sweep, best-effort).
    const res = await this.repository
      .createQueryBuilder()
      .delete()
      .from(Beneficiary)
      .where('user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)')
      .execute();
    return res.affected ?? 0;
  }
}
