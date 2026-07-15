import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { UserAwareThrottlerGuard } from '../../../src/common/guards/user-aware-throttler.guard';
import type { jwtConfig } from '../../../src/config/jwt.config';

/** Expose the protected getTracker for assertion. */
class TestGuard extends UserAwareThrottlerGuard {
  track(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
}

function makeGuard(verify: ReturnType<typeof vi.fn>): TestGuard {
  const jwtService = { verifyAsync: verify } as unknown as JwtService;
  const jwt = { accessSecret: 'secret' } as unknown as ReturnType<typeof jwtConfig>;
  return new TestGuard(
    [],
    {} as unknown as ThrottlerStorage,
    new Reflector(),
    jwtService,
    jwt,
  );
}

describe('UserAwareThrottlerGuard.getTracker', () => {
  const req = (headers: Record<string, string> = {}, ip = '10.0.0.1') => ({ headers, ip });

  it('keys on the verified JWT sub for a valid bearer token', async () => {
    const verify = vi.fn().mockResolvedValue({ sub: 'user-42', type: 'user' });
    const guard = makeGuard(verify);
    expect(await guard.track(req({ authorization: 'Bearer good.token' }))).toBe('user:user-42');
    expect(verify).toHaveBeenCalledWith('good.token', expect.objectContaining({ issuer: 'tove-api' }));
  });

  it('falls back to IP when there is no Authorization header', async () => {
    const verify = vi.fn();
    const guard = makeGuard(verify);
    expect(await guard.track(req({}, '203.0.113.9'))).toBe('ip:203.0.113.9');
    expect(verify).not.toHaveBeenCalled();
  });

  it('falls back to IP when the token is invalid/expired', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('expired'));
    const guard = makeGuard(verify);
    expect(await guard.track(req({ authorization: 'Bearer bad.token' }, '198.51.100.7'))).toBe('ip:198.51.100.7');
  });

  it('falls back to IP for a non-Bearer authorization scheme', async () => {
    const verify = vi.fn();
    const guard = makeGuard(verify);
    expect(await guard.track(req({ authorization: 'Basic abc' }, '192.0.2.5'))).toBe('ip:192.0.2.5');
    expect(verify).not.toHaveBeenCalled();
  });
});
