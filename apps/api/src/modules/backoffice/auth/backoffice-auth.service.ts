import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { backofficeJwtConfig } from '@config/backoffice-jwt.config';
import { AdminRole } from '@common/enums/admin-role.enum';
import { AdminJwtPayload } from '@common/interfaces/jwt-payload.interface';
import {
  TIMING_SAFE_DUMMY_HASH,
  hashRefreshToken,
  verifyRefreshToken,
} from '@common/utils/auth.utils';
import { AdminsService } from '../admins/admins.service';
import { AdminRegisterDto } from '../admins/dto/admin-register.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminResponseDto } from '../admins/dto/admin-response.dto';

@Injectable()
export class BackofficeAuthService {
  private readonly logger = new Logger(BackofficeAuthService.name);

  constructor(
    private readonly adminsService: AdminsService,
    private readonly jwtService: JwtService,
    @Inject(backofficeJwtConfig.KEY)
    private readonly jwt: ConfigType<typeof backofficeJwtConfig>,
  ) {}

  async register(dto: AdminRegisterDto): Promise<AdminResponseDto> {
    let admin: AdminResponseDto;
    try {
      admin = await this.adminsService.create(dto);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as Error & { code: string }).code === '23505'
      ) {
        this.logger.warn(`Admin registration conflict [${dto.email}]`);
        throw new ConflictException('Email already in use');
      }
      throw error;
    }

    this.logger.log(`Admin registered [${admin.id}]`);
    return admin;
  }

  async login(dto: AdminLoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const admin = await this.adminsService.findByEmail(dto.email);

    // Always run bcrypt.compare to prevent timing-based email enumeration.
    // Uses the real hash when admin exists and is active, dummy hash otherwise.
    const hashToCompare = admin?.isActive ? admin.passwordHash : TIMING_SAFE_DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);

    if (!admin || !admin.isActive || !isPasswordValid) {
      this.logger.warn(`Admin login failed [${dto.email}]`);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.logger.log(`Admin login successful [${admin.id}]`);
    return this.generateTokens(admin.id, admin.email, admin.role);
  }

  async refreshTokens(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: AdminJwtPayload;
    try {
      const rawPayload = await this.jwtService.verifyAsync<AdminJwtPayload>(refreshToken, {
        secret: this.jwt.refreshSecret,
        issuer: 'tove-api',
        audience: 'tove-platform',
      });
      if (rawPayload.type !== 'admin') {
        throw new UnauthorizedException('Invalid refresh token');
      }
      payload = rawPayload;
    } catch {
      this.logger.warn('Admin token refresh failed: invalid token');
      throw new UnauthorizedException('Invalid refresh token');
    }

    const admin = await this.adminsService.findEntityById(payload.sub);
    if (!admin || !admin.isActive || !admin.refreshTokenHash) {
      this.logger.warn('Admin token refresh failed: admin invalid');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!verifyRefreshToken(refreshToken, admin.refreshTokenHash, this.jwt.refreshHmacSecret)) {
      this.logger.warn('Admin token refresh failed: hash mismatch');
      throw new UnauthorizedException('Invalid refresh token');
    }

    this.logger.log(`Admin token refresh successful [${admin.id}]`);
    return this.generateTokens(admin.id, admin.email, admin.role);
  }

  async logout(adminId: string): Promise<void> {
    await this.adminsService.updateRefreshTokenHash(adminId, null);
    this.logger.log(`Admin logged out [${adminId}]`);
  }

  async getProfile(adminId: string): Promise<AdminResponseDto> {
    return this.adminsService.findOneById(adminId);
  }

  private async generateTokens(
    adminId: string,
    email: string,
    role: AdminRole,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const jti = randomUUID();

    const tokenPayload = {
      sub: adminId,
      email,
      role,
      type: 'admin' as const,
      jti,
      iss: 'tove-api',
      aud: 'tove-platform',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(tokenPayload, {
        secret: this.jwt.accessSecret,
        expiresIn: this.jwt.accessExpiration,
      } as JwtSignOptions),
      this.jwtService.signAsync(tokenPayload, {
        secret: this.jwt.refreshSecret,
        expiresIn: this.jwt.refreshExpiration,
      } as JwtSignOptions),
    ]);

    const hash = hashRefreshToken(refreshToken, this.jwt.refreshHmacSecret);
    await this.adminsService.updateRefreshTokenHash(adminId, hash);

    return { accessToken, refreshToken };
  }
}
