import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { ADMIN_ROLES_KEY } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { AdminJwtPayload, JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { backofficeJwtConfig } from '@config/backoffice-jwt.config';

@Injectable()
export class BackofficeGuard implements CanActivate {
  private readonly logger = new Logger(BackofficeGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(backofficeJwtConfig.KEY)
    private readonly jwt: ConfigType<typeof backofficeJwtConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only check handler-level @Public(), not class-level.
    // Class-level @Public() on controllers bypasses the global AuthGuard;
    // BackofficeGuard must still authenticate unless the handler itself is @Public().
    const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler());
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      this.logger.warn(`Backoffice auth denied: missing token [${request.method} ${request.url}]`);
      throw new UnauthorizedException();
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.jwt.accessSecret,
        issuer: 'tove-api',
        audience: 'tove-platform',
      });
    } catch {
      this.logger.warn(`Backoffice auth denied: invalid token [${request.method} ${request.url}]`);
      throw new UnauthorizedException();
    }

    if (payload.type !== 'admin') {
      this.logger.warn(`Backoffice auth denied: non-admin token type [${request.method} ${request.url}]`);
      throw new UnauthorizedException();
    }
    (request as unknown as { user: AdminJwtPayload }).user = payload;

    // Check admin role requirements
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles?.length) {
      if (!requiredRoles.includes(payload.role)) {
        this.logger.warn(`Backoffice auth denied: insufficient role [${payload.role}] [${request.method} ${request.url}]`);
        throw new ForbiddenException();
      }
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
