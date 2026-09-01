import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminRepository } from '@modules/backoffice/admins/repositories/admin.repository';
import { Admin } from '@modules/backoffice/admins/entities/admin.entity';
import { DataSource, Repository } from 'typeorm';

describe('AdminRepository', () => {
  let adminRepository: AdminRepository;
  let mockTypeOrmRepo: Partial<Repository<Admin>>;

  beforeEach(() => {
    mockTypeOrmRepo = {
      findOne: vi.fn(),
      update: vi.fn(),
    };

    const mockDataSource = {
      getRepository: vi.fn().mockReturnValue(mockTypeOrmRepo),
    } as unknown as DataSource;

    adminRepository = new AdminRepository(mockDataSource);
  });

  describe('findByEmail', () => {
    it('should find admin by lowercased trimmed email', async () => {
      const mockAdmin = { id: 'test-id', email: 'admin@example.com' } as Admin;
      (mockTypeOrmRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdmin);

      const result = await adminRepository.findByEmail('  Admin@Example.COM  ');

      expect(result).toEqual(mockAdmin);
      expect(mockTypeOrmRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'admin@example.com' },
      });
    });

    it('should return null when admin not found', async () => {
      (mockTypeOrmRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await adminRepository.findByEmail('nobody@example.com');

      expect(result).toBeNull();
    });
  });

  describe('updateRefreshTokenHash', () => {
    it('should update refresh token hash and updatedAt', async () => {
      await adminRepository.updateRefreshTokenHash('test-id', 'some-hash');

      expect(mockTypeOrmRepo.update).toHaveBeenCalledWith('test-id', {
        refreshTokenHash: 'some-hash',
        updatedAt: expect.any(Date) as Date,
      });
    });

    it('should set refresh token hash to null and update updatedAt', async () => {
      await adminRepository.updateRefreshTokenHash('test-id', null);

      expect(mockTypeOrmRepo.update).toHaveBeenCalledWith('test-id', {
        refreshTokenHash: null,
        updatedAt: expect.any(Date) as Date,
      });
    });
  });
});
