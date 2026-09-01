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
import { jwtConfig } from '@config/jwt.config';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import {
  TIMING_SAFE_DUMMY_HASH,
  hashRefreshToken,
  verifyRefreshToken,
} from '@common/utils/auth.utils';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { UsersService } from '@modules/users/users.service';
import { UserStagesService } from '@modules/stages/stages.service';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { ProfileViewService } from '@modules/users/profile/profile-view.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly userStagesService: UserStagesService,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly jwt: ConfigType<typeof jwtConfig>,
    private readonly profileView: ProfileViewService,
  ) {}

  async register(dto: RegisterDto): Promise<{ accessToken: string; refreshToken: string }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    let userResponse: UserResponseDto;
    try {
      userResponse = await this.usersService.create({
        email: dto.email,
        password: dto.password,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });
    } catch (error: unknown) {
      // Handle race condition: concurrent registration with the same email
      // PostgreSQL unique_violation error code is 23505
      if (
        error instanceof Error &&
        'code' in error &&
        (error as Error & { code: string }).code === '23505'
      ) {
        this.logger.warn(`Registration conflict [${dto.email}]`);
        throw new ConflictException('Email already in use');
      }
      throw error;
    }

    this.logger.log(`User registered [${userResponse.id}]`);
    return this.generateTokens(userResponse.id, userResponse.email);
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findByEmail(dto.email);

    // Always run bcrypt.compare to prevent timing-based email enumeration.
    // Uses the real hash when the user exists, is active, and HAS a password
    // (BYOW wallet-only users have a null hash) — dummy hash otherwise.
    const hashToCompare =
      user?.isActive && user.passwordHash ? user.passwordHash : TIMING_SAFE_DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !user.isActive || !isPasswordValid) {
      this.logger.warn(`Login failed [${dto.email}]`);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.logger.log(`Login successful [${user.id}]`);
    return this.generateTokens(user.id, user.email);
  }

  async refreshTokens(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.jwt.refreshSecret,
        issuer: 'tove-api',
        audience: 'tove-platform',
      });
    } catch {
      this.logger.warn('Token refresh failed: invalid token');
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Look up by `sub` (not email) so wallet-only users (null email) refresh too.
    const user = await this.usersService.findEntityById(payload.sub);
    if (!user || !user.isActive || !user.refreshTokenHash) {
      this.logger.warn('Token refresh failed: user invalid');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!verifyRefreshToken(refreshToken, user.refreshTokenHash, this.jwt.refreshHmacSecret)) {
      this.logger.warn('Token refresh failed: hash mismatch');
      throw new UnauthorizedException('Invalid refresh token');
    }

    this.logger.log(`Token refresh successful [${user.id}]`);
    return this.generateTokens(user.id, user.email);
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.updateRefreshTokenHash(userId, null);
    this.logger.log(`User logged out [${userId}]`);
  }

  async getProfile(userId: string): Promise<ProfileResponseDto> {
    const [user, currentStage, profileView] = await Promise.all([
      this.usersService.findOneById(userId),
      this.userStagesService.getCurrentStage(userId),
      this.profileView.buildForUser(userId),
    ]);
    return ProfileResponseDto.create({ user, currentStage, profileView });
  }

  /**
   * Public entry point for non-password login paths (e.g. SEP-10 wallet auth):
   * mints the standard access + refresh pair for an already-authenticated user.
   */
  async issueTokensForUser(user: {
    id: string;
    email: string | null;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    return this.generateTokens(user.id, user.email);
  }

  private async generateTokens(
    userId: string,
    email: string | null,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const jti = randomUUID();

    const tokenPayload = {
      sub: userId,
      email,
      type: 'user' as const,
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
    await this.usersService.updateRefreshTokenHash(userId, hash);

    return { accessToken, refreshToken };
  }
}
