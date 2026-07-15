import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '@modules/auth/auth.service';
import { UsersService } from '@modules/users/users.service';
import { UserStagesService } from '@modules/stages/stages.service';
import { jwtConfig } from '@config/jwt.config';
const mockJwtConfig = {
  accessSecret: 'test-access-secret-that-is-32-chars!',
  refreshSecret: 'test-refresh-secret-that-is-32-chars',
  refreshHmacSecret: 'test-hmac-secret-that-is-32-characters',
  accessExpiration: '15m',
  refreshExpiration: '7d',
};

const mockUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  passwordHash: '$2b$12$somehashedpassword',
  firstName: 'John',
  lastName: 'Doe',
  isActive: true,
  refreshTokenHash: null,
  createdAt: new Date(),
};

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: Partial<UsersService>;
  let userStagesService: Partial<UserStagesService>;
  let jwtService: Partial<JwtService>;

  beforeEach(async () => {
    usersService = {
      findByEmail: vi.fn(),
      create: vi.fn(),
      findOneById: vi.fn(),
      updateRefreshTokenHash: vi.fn(),
    };

    userStagesService = {
      getCurrentStage: vi.fn().mockResolvedValue(null),
    };

    jwtService = {
      signAsync: vi.fn().mockResolvedValue('mock-token'),
      verifyAsync: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: UserStagesService, useValue: userStagesService },
        { provide: JwtService, useValue: jwtService },
        { provide: jwtConfig.KEY, useValue: mockJwtConfig },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should create user and return tokens', async () => {
      (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (usersService.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
      });

      const result = await authService.register({
        email: 'new@example.com',
        password: 'StrongPass1!@#',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw ConflictException if email exists', async () => {
      (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'StrongPass1!@#',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return generic error for non-existent email (no enumeration)', async () => {
      (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'nonexistent@example.com',
          password: 'SomePass1!@#',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });

    it('should return same generic error for wrong password', async () => {
      (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'WrongPass1!@#',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });
  });

  describe('refreshTokens', () => {
    it('should reject invalid refresh token', async () => {
      (jwtService.verifyAsync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('invalid token'),
      );

      await expect(authService.refreshTokens('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should nullify refresh token hash', async () => {
      await authService.logout(mockUser.id);

      expect(usersService.updateRefreshTokenHash).toHaveBeenCalledWith(mockUser.id, null);
    });
  });

  describe('getProfile', () => {
    it('should return ProfileResponseDto with currentStage', async () => {
      const userResponse = {
        id: mockUser.id,
        email: mockUser.email,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        isActive: mockUser.isActive,
        createdAt: mockUser.createdAt,
      };
      const mockStage = {
        id: '550e8400-e29b-41d4-a716-446655440020',
        title: 'Getting Started',
        description: null,
        order: 1,
        isActive: true,
        startsAt: null,
        isEffectivelyActive: true,
        totalMissions: 5,
        completedMissions: 2,
        isCompleted: false,
      };
      (usersService.findOneById as ReturnType<typeof vi.fn>).mockResolvedValue(userResponse);
      (userStagesService.getCurrentStage as ReturnType<typeof vi.fn>).mockResolvedValue(mockStage);

      const result = await authService.getProfile(mockUser.id);

      expect(result.id).toBe(mockUser.id);
      expect(result.email).toBe(mockUser.email);
      expect(result.currentStage).toBe(mockStage);
    });
  });
});
