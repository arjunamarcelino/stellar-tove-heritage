import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
} from '@nestjs/throttler';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { jwtConfig } from '@config/jwt.config';

/**
 * Rate-limit tracker keyed on the caller's identity rather than their IP (TOV-25 #165). For authenticated
 * requests the limit is per JWT `sub`, so shared-NAT users don't consume each other's budget and a single
 * user behind rotating IPs is still bounded. Anonymous or invalid-token requests fall back to IP keying.
 *
 * This guard runs BEFORE {@link AuthGuard} (throttler is the first global guard), so `request.user` is not
 * set yet — it verifies the bearer token itself with the same parameters AuthGuard uses. The double verify
 * (here + AuthGuard) is a small, deliberate cost; an invalid/expired token simply degrades to IP keying and
 * is rejected later by AuthGuard.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY) private readonly jwt: ConfigType<typeof jwtConfig>,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const [type, token] = request.headers?.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
          secret: this.jwt.accessSecret,
          issuer: 'tove-api',
          audience: 'tove-platform',
        });
        if (payload?.sub) return `user:${payload.sub}`;
      } catch {
        // invalid/expired token → degrade to IP keying (AuthGuard rejects it downstream)
      }
    }
    return `ip:${request.ip ?? 'unknown'}`;
  }
}
