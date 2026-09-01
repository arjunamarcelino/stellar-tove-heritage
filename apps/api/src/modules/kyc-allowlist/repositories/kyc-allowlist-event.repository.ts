import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { KycAllowlistEvent } from '../entities/kyc-allowlist-event.entity';
import { NewKycAllowlistEvent } from '../kyc-allowlist.types';
import { IKycAllowlistEventRepository } from './kyc-allowlist-event-repository.interface';

@Injectable()
export class KycAllowlistEventRepository
  extends BaseRepository<KycAllowlistEvent>
  implements IKycAllowlistEventRepository
{
  constructor(dataSource: DataSource) {
    super(KycAllowlistEvent, dataSource);
  }

  async append(rows: NewKycAllowlistEvent[], manager: EntityManager): Promise<void> {
    if (rows.length === 0) return;
    const repo = manager.getRepository(KycAllowlistEvent);
    // create()+save() inserts (no id on the input) — the append-only trigger blocks UPDATE/DELETE, not INSERT.
    await repo.save(rows.map((r) => repo.create(r)));
  }
}
