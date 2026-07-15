import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ErrorCode } from '@common/enums/error-code.enum';
import { jwtConfig } from '@config/jwt.config';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    @Inject(jwtConfig.KEY)
    private readonly jwt: ConfigType<typeof jwtConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      this.logger.warn(`Auth denied: missing token [${request.method} ${request.url}]`);
      // Distinguish "no token supplied" (AUTH_REQUIRED) from an invalid/expired
      // token below (which keeps the default AUTH_INVALID_CREDENTIALS mapping).
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required',
        errorCode: ErrorCode.AUTH_REQUIRED,
      });
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.jwt.accessSecret,
        issuer: 'tove-api',
        audience: 'tove-platform',
      });
    } catch {
      this.logger.warn(`Auth denied: invalid token [${request.method} ${request.url}]`);
      throw new UnauthorizedException();
    }

    // Backward compat: old tokens lack type field
    const rawPayload = payload as unknown as Record<string, unknown>;
    if (!rawPayload.type) {
      rawPayload.type = 'user';
    }
    // Reject admin tokens on user endpoints
    if (payload.type !== 'user') {
      this.logger.warn(`Auth denied: non-user token type [${request.method} ${request.url}]`);
      throw new UnauthorizedException();
    }
    (request as AuthenticatedRequest).user = payload;

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
