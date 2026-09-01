import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { User } from '@modules/users/entities/user.entity';
import { HandleHistory } from '@modules/users/entities/handle-history.entity';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { USER_REPOSITORY } from '@modules/users/repositories/user-repository.interface';
import { HandleHistoryRepository } from '@modules/users/repositories/handle-history.repository';
import { HANDLE_HISTORY_REPOSITORY } from '@modules/users/repositories/handle-history-repository.interface';
import { UsersService } from '@modules/users/users.service';

// UserRepository injects HANDLE_HISTORY_REPOSITORY (TOV-27, setHandle appends history), so it must be provided.
@Module({
  imports: [TypeOrmModule.forFeature([User, HandleHistory])],
  providers: [
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: HANDLE_HISTORY_REPOSITORY, useClass: HandleHistoryRepository },
    UsersService,
  ],
  exports: [UsersService],
})
class TestUsersModule {}

describe('Users Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let usersService: UsersService;

  beforeAll(async () => {
    module = await createTestingModule(TestUsersModule);
    dataSource = module.get(DataSource);
    usersService = module.get(UsersService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  it('should create a user and persist to database', async () => {
    const user = await usersService.create({
      email: 'test@example.com',
      password: 'StrongPass1!@#',
      firstName: 'John',
      lastName: 'Doe',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.firstName).toBe('John');

    const found = await usersService.findOneById(user.id);
    expect(found.email).toBe('test@example.com');
  });

  it('should enforce email uniqueness', async () => {
    await usersService.create({
      email: 'unique@example.com',
      password: 'StrongPass1!@#',
    });

    await expect(
      usersService.create({
        email: 'unique@example.com',
        password: 'StrongPass1!@#',
      }),
    ).rejects.toThrow();
  });

  it('should handle email case-insensitively', async () => {
    await usersService.create({
      email: 'CaseTest@Example.COM',
      password: 'StrongPass1!@#',
    });

    const found = await usersService.findByEmail('casetest@example.com');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('casetest@example.com');
  });

  it('should soft-delete user and exclude from findOneById', async () => {
    const user = await usersService.create({
      email: 'delete@example.com',
      password: 'StrongPass1!@#',
    });

    await usersService.softDelete(user.id);

    await expect(usersService.findOneById(user.id)).rejects.toThrow();
  });

  it('should paginate users correctly', async () => {
    for (let i = 0; i < 15; i++) {
      await usersService.create({
        email: `user${i}@example.com`,
        password: 'StrongPass1!@#',
      });
    }

    const page1 = await usersService.findAll(1, 10);
    expect(page1.data).toHaveLength(10);
    expect(page1.meta.total).toBe(15);
    expect(page1.meta.totalPages).toBe(2);

    const page2 = await usersService.findAll(2, 10);
    expect(page2.data).toHaveLength(5);
  });
});
