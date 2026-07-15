import { Admin } from '../entities/admin.entity';

export interface IAdminRepository {
  findByEmail(email: string): Promise<Admin | null>;
  updateRefreshTokenHash(id: string, hash: string | null): Promise<void>;
}
