import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Admin } from '../entities/admin.entity';
import { IAdminRepository } from './admin-repository.interface';

@Injectable()
export class AdminRepository extends BaseRepository<Admin> implements IAdminRepository {
  constructor(dataSource: DataSource) {
    super(Admin, dataSource);
  }

  async findByEmail(email: string): Promise<Admin | null> {
    return this.repository.findOne({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async updateRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    await this.repository.update(id, { refreshTokenHash: hash, updatedAt: new Date() });
  }
}
