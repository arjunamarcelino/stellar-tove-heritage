import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { IUserRepository, USER_REPOSITORY } from './repositories/user-repository.interface';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IBaseRepository<User> & IUserRepository,
  ) {}

  async findAll(page: number, limit: number): Promise<PaginatedResponseDto<UserResponseDto>> {
    const [users, total] = await this.userRepository.findWithPagination(
      { order: { createdAt: 'DESC' } },
      page,
      limit,
    );
    return PaginatedResponseDto.create(
      users.map((user) => UserResponseDto.fromEntity(user)),
      total,
      page,
      limit,
    );
  }

  async findOneById(id: string): Promise<UserResponseDto> {
    const user = await this.userRepository.findOneById(id);
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return UserResponseDto.fromEntity(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email);
  }

  /** Entity (not DTO) fetch by id — refresh needs `refreshTokenHash`/`isActive`. */
  async findEntityById(id: string): Promise<User | null> {
    return this.userRepository.findOneById(id);
  }

  /**
   * Create a credential-less (BYOW wallet-only) User within a caller-supplied
   * transaction. The users domain owns the User aggregate's invariants; the
   * `EntityManager` keeps this insert atomic with the caller's wallet insert.
   */
  async createWalletUser(manager: EntityManager): Promise<User> {
    const user = manager.create(User, { email: null, passwordHash: null, isActive: true });
    return manager.save(user);
  }

  /**
   * Create an embedded-passkey User (email, no password) within a caller-supplied
   * transaction. Allowed by CHK_users_password_needs_email; the entity's
   * normalizeEmail hook lower-cases the email on insert.
   */
  async createPasskeyUser(manager: EntityManager, email: string): Promise<User> {
    const user = manager.create(User, { email, passwordHash: null, isActive: true });
    return manager.save(user);
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.userRepository.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
    });
    const saved = await this.userRepository.save(user);
    return UserResponseDto.fromEntity(saved);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.userRepository.update(id, dto);
    return UserResponseDto.fromEntity(user);
  }

  async softDelete(id: string): Promise<void> {
    const user = await this.userRepository.findOneById(id);
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    user.refreshTokenHash = null;
    await this.userRepository.softRemove(user);
  }

  async count(): Promise<number> {
    return this.userRepository.count();
  }

  async updateRefreshTokenHash(userId: string, hash: string | null): Promise<void> {
    await this.userRepository.update(userId, { refreshTokenHash: hash });
  }
}
