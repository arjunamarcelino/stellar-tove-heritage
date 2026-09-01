import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { User } from '@modules/users/entities/user.entity';
import { HandleHistory } from '@modules/users/entities/handle-history.entity';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { USER_REPOSITORY } from '@modules/users/repositories/user-repository.interface';
import { HandleHistoryRepository } from '@modules/users/repositories/handle-history.repository';
import { HANDLE_HISTORY_REPOSITORY } from '@modules/users/repositories/handle-history-repository.interface';
import { UsersService } from '@modules/users/users.service';
import { ProfileViewService } from '@modules/users/profile/profile-view.service';
import { AuthService } from '@modules/auth/auth.service';
import { UserStagesService } from '@modules/stages/stages.service';
import { jwtConfig } from '@config/jwt.config';

const testJwtConfig = {
  accessSecret: 'test-access-secret-that-is-at-least-32-chars!',
  refreshSecret: 'test-refresh-secret-that-is-at-least-32chars',
  refreshHmacSecret: 'test-hmac-secret-that-is-at-least-32-chars!',
  accessExpiration: '15m',
  refreshExpiration: '7d',
};

@Module({
  imports: [TypeOrmModule.forFeature([User, HandleHistory]), JwtModule.register({})],
  providers: [
    { provide: USER_REPOSITORY, useClass: UserRepository },
    // UserRepository injects HANDLE_HISTORY_REPOSITORY (TOV-27), so it must be provided even here.
    { provide: HANDLE_HISTORY_REPOSITORY, useClass: HandleHistoryRepository },
    UsersService,
    AuthService,
    // These tests exercise the token flows (register/login/refresh/logout), not
    // getProfile, so UserStagesService (a getProfile dependency) is stubbed to
    // avoid dragging in the full stages/backoffice module graph.
    { provide: UserStagesService, useValue: { getCurrentStage: () => Promise.resolve(null) } },
    // getProfile also builds the profile view (TOV-30) — stubbed; these tests exercise token flows.
    { provide: ProfileViewService, useValue: { buildForUser: () => Promise.resolve({}) } },
    { provide: jwtConfig.KEY, useValue: testJwtConfig },
  ],
  exports: [UsersService, AuthService],
})
class TestAuthModule {}

describe('Auth Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = testJwtConfig.accessSecret;
    process.env.JWT_REFRESH_SECRET = testJwtConfig.refreshSecret;
    process.env.REFRESH_TOKEN_HMAC_SECRET = testJwtConfig.refreshHmacSecret;

    module = await createTestingModule(TestAuthModule);
    dataSource = module.get(DataSource);
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  it('should register a user and return valid JWT', async () => {
    const result = await authService.register({
      email: 'newuser@example.com',
      password: 'StrongPass1!@#',
      firstName: 'Test',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();

    const user = await usersService.findByEmail('newuser@example.com');
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe('StrongPass1!@#');
    expect(user!.refreshTokenHash).not.toBeNull();
  });

  it('should login with valid credentials and return JWT', async () => {
    await authService.register({
      email: 'login@example.com',
      password: 'StrongPass1!@#',
    });

    const result = await authService.login({
      email: 'login@example.com',
      password: 'StrongPass1!@#',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  it('should rotate refresh token hash on refresh', async () => {
    const registration = await authService.register({
      email: 'refresh@example.com',
      password: 'StrongPass1!@#',
    });

    const userBefore = await usersService.findByEmail('refresh@example.com');
    const hashBefore = userBefore!.refreshTokenHash;

    const refreshed = await authService.refreshTokens(registration.refreshToken);

    const userAfter = await usersService.findByEmail('refresh@example.com');
    expect(userAfter!.refreshTokenHash).not.toBe(hashBefore);
    expect(refreshed.accessToken).toBeDefined();
  });

  it('should nullify refresh token hash on logout', async () => {
    await authService.register({
      email: 'logout@example.com',
      password: 'StrongPass1!@#',
    });

    const userBefore = await usersService.findByEmail('logout@example.com');
    expect(userBefore!.refreshTokenHash).not.toBeNull();

    await authService.logout(userBefore!.id);

    const userAfter = await usersService.findByEmail('logout@example.com');
    expect(userAfter!.refreshTokenHash).toBeNull();
  });
});
