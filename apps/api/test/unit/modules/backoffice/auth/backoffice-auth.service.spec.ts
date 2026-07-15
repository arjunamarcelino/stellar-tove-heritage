import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BackofficeAuthService } from '@modules/backoffice/auth/backoffice-auth.service';
import { AdminsService } from '@modules/backoffice/admins/admins.service';
import { backofficeJwtConfig } from '@config/backoffice-jwt.config';
import { AdminRole } from '@common/enums/admin-role.enum';

const mockJwtConfig = {
  accessSecret: 'test-access-secret-that-is-32-chars!',
  refreshSecret: 'test-refresh-secret-that-is-32-chars',
  refreshHmacSecret: 'test-hmac-secret-that-is-32-characters',
  accessExpiration: '15m',
  refreshExpiration: '7d',
};

const mockAdmin = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  email: 'admin@example.com',
  passwordHash: '$2b$12$LJ3m4ys3Lf.MpGNXHOY9a.5F6DzWGd6F3E.GnEsS3FLzT3lXz0gKu',
  role: AdminRole.ADMIN,
  firstName: 'Test',
  lastName: 'Admin',
  isActive: true,
  refreshTokenHash: null,
  createdAt: new Date(),
};

const mockAdminResponse = {
  id: mockAdmin.id,
  email: mockAdmin.email,
  role: mockAdmin.role,
  firstName: mockAdmin.firstName,
  lastName: mockAdmin.lastName,
  isActive: mockAdmin.isActive,
  createdAt: mockAdmin.createdAt,
};

describe('BackofficeAuthService', () => {
  let service: BackofficeAuthService;
  let adminsService: Record<string, ReturnType<typeof vi.fn>>;
  let jwtService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    adminsService = {
      findByEmail: vi.fn(),
      findEntityById: vi.fn(),
      create: vi.fn(),
      findOneById: vi.fn(),
      updateRefreshTokenHash: vi.fn(),
    };

    jwtService = {
      signAsync: vi.fn().mockResolvedValue('mock-token'),
      verifyAsync: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackofficeAuthService,
        { provide: AdminsService, useValue: adminsService },
        { provide: JwtService, useValue: jwtService },
        { provide: backofficeJwtConfig.KEY, useValue: mockJwtConfig },
      ],
    }).compile();

    service = module.get<BackofficeAuthService>(BackofficeAuthService);
  });

  describe('register', () => {
    it('should create admin and return response DTO', async () => {
      adminsService.create.mockResolvedValue(mockAdminResponse);

      const result = await service.register({
        email: 'new@example.com',
        password: 'StrongPass1!@#',
      });

      expect(result).toEqual(mockAdminResponse);
      expect(adminsService.create).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'StrongPass1!@#',
      });
    });

    it('should throw ConflictException on duplicate email (23505)', async () => {
      const dbError = new Error('duplicate key') as Error & { code: string };
      dbError.code = '23505';
      adminsService.create.mockRejectedValue(dbError);

      await expect(
        service.register({
          email: 'existing@example.com',
          password: 'StrongPass1!@#',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-23505 errors', async () => {
      adminsService.create.mockRejectedValue(new Error('some other error'));

      await expect(
        service.register({
          email: 'new@example.com',
          password: 'StrongPass1!@#',
        }),
      ).rejects.toThrow('some other error');
    });
  });

  describe('login', () => {
    it('should return generic error for non-existent email (timing-safe)', async () => {
      adminsService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nonexistent@example.com', password: 'SomePass1!@#' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });

    it('should return generic error for inactive admin', async () => {
      adminsService.findByEmail.mockResolvedValue({ ...mockAdmin, isActive: false });

      await expect(
        service.login({ email: mockAdmin.email, password: 'SomePass1!@#' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });

    it('should return generic error for wrong password', async () => {
      adminsService.findByEmail.mockResolvedValue(mockAdmin);

      await expect(
        service.login({ email: mockAdmin.email, password: 'WrongPass1!@#' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });
  });

  describe('refreshTokens', () => {
    it('should reject invalid refresh token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject token with type !== admin', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: mockAdmin.id,
        email: mockAdmin.email,
        role: 'user',
        type: 'user',
      });

      await expect(service.refreshTokens('valid-but-user-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject if admin not found', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: mockAdmin.id,
        email: mockAdmin.email,
        role: AdminRole.ADMIN,
        type: 'admin',
      });
      adminsService.findEntityById.mockResolvedValue(null);

      await expect(service.refreshTokens('some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject if admin is inactive', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: mockAdmin.id,
        email: mockAdmin.email,
        role: AdminRole.ADMIN,
        type: 'admin',
      });
      adminsService.findEntityById.mockResolvedValue({ ...mockAdmin, isActive: false });

      await expect(service.refreshTokens('some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should nullify refresh token hash', async () => {
      await service.logout(mockAdmin.id);

      expect(adminsService.updateRefreshTokenHash).toHaveBeenCalledWith(mockAdmin.id, null);
    });
  });

  describe('getProfile', () => {
    it('should return admin profile', async () => {
      adminsService.findOneById.mockResolvedValue(mockAdminResponse);

      const result = await service.getProfile(mockAdmin.id);

      expect(result).toEqual(mockAdminResponse);
      expect(adminsService.findOneById).toHaveBeenCalledWith(mockAdmin.id);
    });
  });
});
