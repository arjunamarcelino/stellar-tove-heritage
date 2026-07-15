import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { AdminRole } from '@common/enums/admin-role.enum';
import { Admin } from './entities/admin.entity';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AdminResponseDto } from './dto/admin-response.dto';
import { IAdminRepository } from './repositories/admin-repository.interface';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminsService {
  constructor(
    @Inject('IAdminRepository')
    private readonly adminRepository: IBaseRepository<Admin> & IAdminRepository,
  ) {}

  async findAll(page: number, limit: number): Promise<PaginatedResponseDto<AdminResponseDto>> {
    const [admins, total] = await this.adminRepository.findWithPagination(
      { order: { createdAt: 'DESC' } },
      page,
      limit,
    );
    return PaginatedResponseDto.create(
      admins.map((admin) => AdminResponseDto.fromEntity(admin)),
      total,
      page,
      limit,
    );
  }

  async findOneById(id: string): Promise<AdminResponseDto> {
    const admin = await this.adminRepository.findOneById(id);
    if (!admin) {
      throw new NotFoundException('Resource not found');
    }
    return AdminResponseDto.fromEntity(admin);
  }

  async findEntityById(id: string): Promise<Admin | null> {
    return this.adminRepository.findOneById(id);
  }

  async findByEmail(email: string): Promise<Admin | null> {
    return this.adminRepository.findByEmail(email);
  }

  async create(dto: AdminRegisterDto): Promise<AdminResponseDto> {
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const admin = this.adminRepository.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      role: dto.role ?? AdminRole.ADMIN,
    });
    const saved = await this.adminRepository.save(admin);
    return AdminResponseDto.fromEntity(saved);
  }

  async update(id: string, dto: UpdateAdminDto): Promise<AdminResponseDto> {
    const admin = await this.adminRepository.findOneById(id);
    if (!admin) {
      throw new NotFoundException('Resource not found');
    }

    const isDemotingSuperadmin =
      admin.role === AdminRole.SUPERADMIN &&
      dto.role !== undefined &&
      dto.role !== AdminRole.SUPERADMIN;

    if (isDemotingSuperadmin) {
      const saved = await this.adminRepository.runInTransaction(async (manager) => {
        await this.ensureNotLastSuperadmin(manager, 'demote');
        this.applyUpdate(admin, dto);
        return manager.save(admin);
      });
      return AdminResponseDto.fromEntity(saved);
    }

    this.applyUpdate(admin, dto);
    const saved = await this.adminRepository.save(admin);
    return AdminResponseDto.fromEntity(saved);
  }

  async softDelete(id: string): Promise<void> {
    const admin = await this.adminRepository.findOneById(id);
    if (!admin) {
      throw new NotFoundException('Resource not found');
    }

    if (admin.role === AdminRole.SUPERADMIN) {
      await this.adminRepository.runInTransaction(async (manager) => {
        await this.ensureNotLastSuperadmin(manager, 'delete');
        admin.refreshTokenHash = null;
        await manager.softRemove(admin);
      });
      return;
    }

    admin.refreshTokenHash = null;
    await this.adminRepository.softRemove(admin);
  }

  private applyUpdate(admin: Admin, dto: UpdateAdminDto): void {
    if (dto.firstName !== undefined) admin.firstName = dto.firstName;
    if (dto.lastName !== undefined) admin.lastName = dto.lastName;
    if (dto.role !== undefined) admin.role = dto.role;
  }

  private async ensureNotLastSuperadmin(
    manager: EntityManager,
    action: string,
  ): Promise<void> {
    const superadmins = await manager
      .createQueryBuilder(Admin, 'admin')
      .setLock('pessimistic_write')
      .where('admin.role = :role', { role: AdminRole.SUPERADMIN })
      .andWhere('admin.is_active = :isActive', { isActive: true })
      .andWhere('admin.deleted_at IS NULL')
      .getMany();
    if (superadmins.length <= 1) {
      throw new BadRequestException(`Cannot ${action} the last superadmin`);
    }
  }

  async updateRefreshTokenHash(adminId: string, hash: string | null): Promise<void> {
    await this.adminRepository.updateRefreshTokenHash(adminId, hash);
  }
}
