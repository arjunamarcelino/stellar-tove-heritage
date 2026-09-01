import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AdminsService } from '@modules/backoffice/admins/admins.service';
import { Admin } from '@modules/backoffice/admins/entities/admin.entity';
import { AdminRole } from '@common/enums/admin-role.enum';

const mockAdmin: Partial<Admin> = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  email: 'admin@example.com',
  passwordHash: '$2b$12$hashedpassword',
  role: AdminRole.ADMIN,
  firstName: 'Test',
  lastName: 'Admin',
  isActive: true,
  refreshTokenHash: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

// Helper to create a mock EntityManager with chainable QueryBuilder
function createMockManager(superadminCount: number) {
  const mockQb = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(Array(superadminCount).fill({ role: AdminRole.SUPERADMIN })),
  };
  return {
    createQueryBuilder: vi.fn().mockReturnValue(mockQb),
    save: vi.fn().mockImplementation((entity: unknown) => Promise.resolve(entity)),
    softRemove: vi.fn().mockImplementation((entity: unknown) => Promise.resolve(entity)),
    _qb: mockQb,
  };
}

const mockAdminRepository = {
  create: vi.fn(),
  save: vi.fn(),
  saveMany: vi.fn(),
  findOneById: vi.fn(),
  findOne: vi.fn(),
  findAll: vi.fn(),
  findWithPagination: vi.fn(),
  update: vi.fn(),
  softRemove: vi.fn(),
  count: vi.fn(),
  exists: vi.fn(),
  findByEmail: vi.fn(),
  updateRefreshTokenHash: vi.fn(),
  runInTransaction: vi.fn(),
};

describe('AdminsService', () => {
  let service: AdminsService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminsService,
        { provide: 'IAdminRepository', useValue: mockAdminRepository },
      ],
    }).compile();

    service = module.get<AdminsService>(AdminsService);
  });

  describe('findAll', () => {
    it('should return paginated admins', async () => {
      const admins = [mockAdmin as Admin];
      mockAdminRepository.findWithPagination.mockResolvedValue([admins, 1]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(mockAdminRepository.findWithPagination).toHaveBeenCalledWith(
        { order: { createdAt: 'DESC' } },
        1,
        10,
      );
    });
  });

  describe('findOneById', () => {
    it('should return an admin when found', async () => {
      mockAdminRepository.findOneById.mockResolvedValue(mockAdmin);

      const result = await service.findOneById(mockAdmin.id!);

      expect(result.id).toBe(mockAdmin.id);
      expect(result.email).toBe(mockAdmin.email);
    });

    it('should throw NotFoundException when admin not found', async () => {
      mockAdminRepository.findOneById.mockResolvedValue(null);

      await expect(service.findOneById('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findEntityById', () => {
    it('should return raw admin entity when found', async () => {
      mockAdminRepository.findOneById.mockResolvedValue(mockAdmin);

      const result = await service.findEntityById(mockAdmin.id!);

      expect(result).toEqual(mockAdmin);
      expect(mockAdminRepository.findOneById).toHaveBeenCalledWith(mockAdmin.id);
    });

    it('should return null when admin not found', async () => {
      mockAdminRepository.findOneById.mockResolvedValue(null);

      const result = await service.findEntityById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should hash password and save admin', async () => {
      const dto = {
        email: 'new@example.com',
        password: 'StrongPass1!@#',
        firstName: 'Jane',
        lastName: 'Admin',
      };

      mockAdminRepository.create.mockReturnValue({ ...mockAdmin, email: dto.email });
      mockAdminRepository.save.mockResolvedValue({
        ...mockAdmin,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });

      const result = await service.create(dto);

      expect(result.email).toBe(dto.email);
      expect(mockAdminRepository.create).toHaveBeenCalled();
      const createCall = mockAdminRepository.create.mock.calls[0][0] as Record<string, unknown>;
      expect(createCall.passwordHash).toBeDefined();
      expect(createCall.passwordHash).not.toBe(dto.password);
    });

    it('should default role to ADMIN when not specified', async () => {
      const dto = {
        email: 'new@example.com',
        password: 'StrongPass1!@#',
      };

      mockAdminRepository.create.mockReturnValue({ ...mockAdmin, email: dto.email });
      mockAdminRepository.save.mockResolvedValue({ ...mockAdmin, email: dto.email });

      await service.create(dto);

      const createCall = mockAdminRepository.create.mock.calls[0][0] as Record<string, unknown>;
      expect(createCall.role).toBe(AdminRole.ADMIN);
    });
  });

  describe('update', () => {
    it('should update admin and return response', async () => {
      const updateDto = { firstName: 'Updated' };
      mockAdminRepository.findOneById.mockResolvedValue({ ...mockAdmin });
      mockAdminRepository.save.mockResolvedValue({
        ...mockAdmin,
        firstName: 'Updated',
      });

      const result = await service.update(mockAdmin.id!, updateDto);

      expect(result.firstName).toBe('Updated');
    });

    it('should not apply unexpected fields (mass assignment protection)', async () => {
      const admin = { ...mockAdmin };
      mockAdminRepository.findOneById.mockResolvedValue(admin);
      mockAdminRepository.save.mockImplementation(
        (entity: unknown) => Promise.resolve(entity),
      );

      // Pass extra fields that shouldn't be applied
      await service.update(mockAdmin.id!, {
        firstName: 'Safe',
        ...({ passwordHash: 'hacked', refreshTokenHash: 'injected', isActive: false } as Record<string, unknown>),
      });

      // Only allowed fields should be updated
      expect(admin.firstName).toBe('Safe');
      expect(admin.passwordHash).toBe(mockAdmin.passwordHash);
      expect(admin.refreshTokenHash).toBe(mockAdmin.refreshTokenHash);
      expect(admin.isActive).toBe(mockAdmin.isActive);
    });

    it('should throw NotFoundException when admin not found', async () => {
      mockAdminRepository.findOneById.mockResolvedValue(null);

      await expect(service.update('nonexistent', { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should prevent demoting the last superadmin', async () => {
      const superadmin = { ...mockAdmin, role: AdminRole.SUPERADMIN };
      mockAdminRepository.findOneById.mockResolvedValue(superadmin);
      const manager = createMockManager(1);
      mockAdminRepository.runInTransaction.mockImplementation(
        async (work: (m: unknown) => Promise<unknown>) => work(manager),
      );

      await expect(
        service.update(mockAdmin.id!, { role: AdminRole.ADMIN }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow demoting a superadmin when others exist', async () => {
      const superadmin = { ...mockAdmin, role: AdminRole.SUPERADMIN };
      mockAdminRepository.findOneById.mockResolvedValue({ ...superadmin });
      const manager = createMockManager(2);
      manager.save.mockResolvedValue({ ...superadmin, role: AdminRole.ADMIN });
      mockAdminRepository.runInTransaction.mockImplementation(
        async (work: (m: unknown) => Promise<unknown>) => work(manager),
      );

      const result = await service.update(mockAdmin.id!, { role: AdminRole.ADMIN });

      expect(result.role).toBe(AdminRole.ADMIN);
      expect(manager.save).toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('should nullify refresh token and soft remove admin', async () => {
      mockAdminRepository.findOneById.mockResolvedValue({ ...mockAdmin });
      mockAdminRepository.softRemove.mockResolvedValue({ ...mockAdmin, deletedAt: new Date() });

      await service.softDelete(mockAdmin.id!);

      expect(mockAdminRepository.softRemove).toHaveBeenCalled();
    });

    it('should throw NotFoundException when admin not found', async () => {
      mockAdminRepository.findOneById.mockResolvedValue(null);

      await expect(service.softDelete('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should prevent deleting the last superadmin', async () => {
      const superadmin = { ...mockAdmin, role: AdminRole.SUPERADMIN };
      mockAdminRepository.findOneById.mockResolvedValue(superadmin);
      const manager = createMockManager(1);
      mockAdminRepository.runInTransaction.mockImplementation(
        async (work: (m: unknown) => Promise<unknown>) => work(manager),
      );

      await expect(service.softDelete(mockAdmin.id!)).rejects.toThrow(BadRequestException);
    });

    it('should allow deleting a superadmin when others exist', async () => {
      const superadmin = { ...mockAdmin, role: AdminRole.SUPERADMIN };
      mockAdminRepository.findOneById.mockResolvedValue({ ...superadmin });
      const manager = createMockManager(2);
      mockAdminRepository.runInTransaction.mockImplementation(
        async (work: (m: unknown) => Promise<unknown>) => work(manager),
      );

      await service.softDelete(mockAdmin.id!);

      expect(manager.softRemove).toHaveBeenCalled();
    });
  });

  describe('updateRefreshTokenHash', () => {
    it('should delegate to repository', async () => {
      await service.updateRefreshTokenHash(mockAdmin.id!, 'some-hash');

      expect(mockAdminRepository.updateRefreshTokenHash).toHaveBeenCalledWith(
        mockAdmin.id,
        'some-hash',
      );
    });
  });
});
