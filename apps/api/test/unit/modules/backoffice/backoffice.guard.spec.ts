import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { AdminRole } from '@common/enums/admin-role.enum';

const mockJwtConfig = {
  accessSecret: 'test-access-secret-that-is-32-chars!',
  refreshSecret: 'test-refresh-secret-that-is-32-chars',
  refreshHmacSecret: 'test-hmac-secret-that-is-32-characters',
  accessExpiration: '15m',
  refreshExpiration: '7d',
};

const mockAdminPayload = {
  sub: '550e8400-e29b-41d4-a716-446655440001',
  email: 'admin@example.com',
  role: AdminRole.SUPERADMIN,
  type: 'admin' as const,
  jti: 'test-jti',
  iss: 'tove-api',
  aud: 'tove-platform',
};

function createMockContext(authorization?: string): ExecutionContext {
  const request = {
    headers: { authorization },
    user: undefined,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('BackofficeGuard', () => {
  let guard: BackofficeGuard;
  let reflector: Reflector;
  let jwtService: JwtService;

  beforeEach(() => {
    reflector = {
      get: vi.fn().mockReturnValue(undefined),
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;

    jwtService = {
      verifyAsync: vi.fn().mockResolvedValue(mockAdminPayload),
    } as unknown as JwtService;

    guard = new BackofficeGuard(reflector, jwtService, mockJwtConfig);
  });

  it('should allow access when handler is marked @Public()', async () => {
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    const context = createMockContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should NOT skip auth when only class-level @Public() is set (handler has none)', async () => {
    // reflector.get on handler returns undefined (no handler-level @Public())
    // This verifies BackofficeGuard checks handler only, not class
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const context = createMockContext(); // no auth header

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject when no authorization header', async () => {
    const context = createMockContext();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject when token verification fails', async () => {
    (jwtService.verifyAsync as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('invalid token'),
    );
    const context = createMockContext('Bearer invalid-token');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject when token type is not admin', async () => {
    (jwtService.verifyAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockAdminPayload,
      type: 'user',
    });
    const context = createMockContext('Bearer user-token');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should allow admin token with no role requirement', async () => {
    const context = createMockContext('Bearer valid-admin-token');

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow admin token matching required role', async () => {
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(false); // isPublic (handler)
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([AdminRole.SUPERADMIN]); // requiredRoles

    const context = createMockContext('Bearer valid-admin-token');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should reject admin token not matching required role', async () => {
    const adminPayload = { ...mockAdminPayload, role: AdminRole.ADMIN };
    (jwtService.verifyAsync as ReturnType<typeof vi.fn>).mockResolvedValue(adminPayload);
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(false); // isPublic (handler)
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([AdminRole.SUPERADMIN]); // requiredRoles

    const context = createMockContext('Bearer valid-admin-token');

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should verify JWT with issuer and audience', async () => {
    const context = createMockContext('Bearer valid-admin-token');

    await guard.canActivate(context);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-admin-token', {
      secret: mockJwtConfig.accessSecret,
      issuer: 'tove-api',
      audience: 'tove-platform',
    });
  });

  it('should set request.user on successful authentication', async () => {
    const context = createMockContext('Bearer valid-admin-token');

    await guard.canActivate(context);

     
    const request: { user: unknown } = context.switchToHttp().getRequest();
    expect(request.user).toEqual(mockAdminPayload);
  });
});
