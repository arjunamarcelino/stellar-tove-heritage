import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from '@modules/users/users.service';
import { User } from '@modules/users/entities/user.entity';
import { USER_REPOSITORY } from '@modules/users/repositories/user-repository.interface';

const mockUser: Partial<User> = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  passwordHash: '$2b$12$hashedpassword',
  firstName: 'John',
  lastName: 'Doe',
  isActive: true,
  refreshTokenHash: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

const mockUserRepository = {
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
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: USER_REPOSITORY, useValue: mockUserRepository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const users = [mockUser as User];
      mockUserRepository.findWithPagination.mockResolvedValue([users, 1]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(mockUserRepository.findWithPagination).toHaveBeenCalledWith(
        { order: { createdAt: 'DESC' } },
        1,
        10,
      );
    });
  });

  describe('findOneById', () => {
    it('should return a user when found', async () => {
      mockUserRepository.findOneById.mockResolvedValue(mockUser);

      const result = await service.findOneById(mockUser.id!);

      expect(result.id).toBe(mockUser.id);
      expect(result.email).toBe(mockUser.email);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOneById.mockResolvedValue(null);

      await expect(service.findOneById('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should hash password and save user', async () => {
      const dto = {
        email: 'new@example.com',
        password: 'StrongPass1!@#',
        firstName: 'Jane',
        lastName: 'Doe',
      };

      mockUserRepository.create.mockReturnValue({ ...mockUser, email: dto.email });
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });

      const result = await service.create(dto);

      expect(result.email).toBe(dto.email);
      expect(mockUserRepository.create).toHaveBeenCalled();
      // Verify password was hashed (create was called with passwordHash, not password)
      const createCall = mockUserRepository.create.mock.calls[0][0] as Record<string, unknown>;
      expect(createCall.passwordHash).toBeDefined();
      expect(createCall.passwordHash).not.toBe(dto.password);
    });
  });

  describe('update', () => {
    it('should call repository update and return response', async () => {
      const updateDto = { firstName: 'Updated' };
      mockUserRepository.update.mockResolvedValue({
        ...mockUser,
        firstName: 'Updated',
      });

      const result = await service.update(mockUser.id!, updateDto);

      expect(result.firstName).toBe('Updated');
      expect(mockUserRepository.update).toHaveBeenCalledWith(mockUser.id, updateDto);
    });
  });

  describe('softDelete', () => {
    it('should null refresh token hash and soft remove user', async () => {
      const userCopy = { ...mockUser };
      mockUserRepository.findOneById.mockResolvedValue(userCopy);
      mockUserRepository.softRemove.mockResolvedValue({ ...userCopy, deletedAt: new Date() });

      await service.softDelete(mockUser.id!);

      expect(userCopy.refreshTokenHash).toBeNull();
      expect(mockUserRepository.softRemove).toHaveBeenCalledWith(userCopy);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOneById.mockResolvedValue(null);

      await expect(service.softDelete('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
