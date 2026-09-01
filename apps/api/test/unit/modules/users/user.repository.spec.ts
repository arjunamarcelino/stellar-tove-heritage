import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { User } from '@modules/users/entities/user.entity';

describe('UserRepository', () => {
  let userRepository: UserRepository;
  let mockTypeOrmRepo: Partial<Repository<User>>;

  beforeEach(() => {
    mockTypeOrmRepo = {
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
    };

    const mockDataSource = {
      getRepository: vi.fn().mockReturnValue(mockTypeOrmRepo),
    } as unknown as DataSource;

    userRepository = new UserRepository(mockDataSource);
  });

  describe('findByEmail', () => {
    it('should call findOne with lowercase email', async () => {
      (mockTypeOrmRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await userRepository.findByEmail('Test@Example.COM');

      expect(mockTypeOrmRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should return user when found', async () => {
      const mockUser = { id: '1', email: 'test@example.com' } as User;
      (mockTypeOrmRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      const result = await userRepository.findByEmail('test@example.com');

      expect(result).toEqual(mockUser);
    });
  });
});
