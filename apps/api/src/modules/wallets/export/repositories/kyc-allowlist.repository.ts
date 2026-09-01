import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { FractionKycAllowlist } from '../entities/fraction-kyc-allowlist.entity';
import { IKycAllowlistRepository } from './kyc-allowlist-repository.interface';

@Injectable()
export class KycAllowlistRepository
  extends BaseRepository<FractionKycAllowlist>
  implements IKycAllowlistRepository
{
  constructor(dataSource: DataSource) {
    super(FractionKycAllowlist, dataSource);
  }

  async existsActive(targetAddress: string): Promise<boolean> {
    // TypeORM excludes soft-deleted rows by default, so this counts only live allowlist entries.
    return this.repository.existsBy({ targetAddress });
  }
}
