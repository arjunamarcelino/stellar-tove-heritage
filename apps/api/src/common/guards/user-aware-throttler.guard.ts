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
import { backofficeJwtConfig } from '@config/backoffice-jwt.config';

/**
 * Rate-limit tracker keyed on the caller's identity rather than their IP (TOV-25 #165). For authenticated
 * requests the limit is per JWT `sub`, so shared-NAT users don't consume each other's budget and a single
 * user behind rotating IPs is still bounded. Anonymous or invalid-token requests fall back to IP keying.
 *
 * User and admin tokens are signed with DIFFERENT secrets, so we try both: user first (`user:<sub>`), then
 * the backoffice/admin secret (`admin:<sub>`, todo 268). Before this, admin tokens failed the user-secret
 * verify and silently degraded to per-IP keying, so all admins behind a shared NAT/LB egress shared one
 * bucket (self-DoS) and a leaked admin token got a full per-IP budget with no per-identity ceiling.
 *
 * This guard runs BEFORE {@link AuthGuard} (throttler is the first global guard), so `request.user` is not
 * set yet — it verifies the bearer token itself with the same parameters those guards use. The extra verify
 * is a small, deliberate cost; an invalid/expired token simply degrades to IP keying and is rejected later.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY) private readonly jwt: ConfigType<typeof jwtConfig>,
    @Inject(backofficeJwtConfig.KEY) private readonly backofficeJwt: ConfigType<typeof backofficeJwtConfig>,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const [type, token] = request.headers?.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      // 1) user token → per-user sub
      try {
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
          secret: this.jwt.accessSecret,
          issuer: 'tove-api',
          audience: 'tove-platform',
        });
        if (payload?.sub) return `user:${payload.sub}`;
      } catch {
        // not a user token — fall through to the admin secret
      }
      // 2) admin/backoffice token (different secret) → per-admin sub (todo 268)
      try {
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
          secret: this.backofficeJwt.accessSecret,
          issuer: 'tove-api',
          audience: 'tove-platform',
        });
        if (payload?.type === 'admin' && payload?.sub) return `admin:${payload.sub}`;
      } catch {
        // invalid/expired token → degrade to IP keying (the auth guard rejects it downstream)
      }
    }
    return `ip:${request.ip ?? 'unknown'}`;
  }
}
