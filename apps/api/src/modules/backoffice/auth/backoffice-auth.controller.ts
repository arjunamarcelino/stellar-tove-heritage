import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigType } from '@nestjs/config';
import { Response, Request } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { BackofficeRequest } from '@common/interfaces/backoffice-request.interface';
import { parseDurationMs } from '@common/utils/auth.utils';
import { appConfig } from '@config/app.config';
import { backofficeJwtConfig } from '@config/backoffice-jwt.config';
import { BackofficeAuthService } from './backoffice-auth.service';
import { AdminRegisterDto } from '../admins/dto/admin-register.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { AdminTokenResponseDto } from './dto/admin-token-response.dto';
import { AdminResponseDto } from '../admins/dto/admin-response.dto';

const BO_REFRESH_COOKIE_NAME = 'bo_refresh_token';

@ApiTags('Backoffice Auth')
@Controller('auth')
@Public()
@UseGuards(BackofficeGuard)
export class BackofficeAuthController {
  constructor(
    private readonly backofficeAuthService: BackofficeAuthService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
    @Inject(backofficeJwtConfig.KEY)
    private readonly jwt: ConfigType<typeof backofficeJwtConfig>,
  ) {}

  @Post('register')
  @AdminRoles(AdminRole.SUPERADMIN)
  @ApiOperation({ summary: 'Register a new admin (superadmin only)' })
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: AdminResponseDto })
  async register(@Body() dto: AdminRegisterDto): Promise<AdminResponseDto> {
    return this.backofficeAuthService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Admin login' })
  @ApiOkResponse({ type: AdminTokenResponseDto })
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminTokenResponseDto> {
    const { accessToken, refreshToken } =
      await this.backofficeAuthService.login(dto);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, refreshToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Refresh admin tokens' })
  @ApiOkResponse({ type: AdminTokenResponseDto })
  async refresh(
    @Body() dto: AdminRefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminTokenResponseDto> {
    const refreshToken =
      dto.refreshToken ??
      (req.cookies?.[BO_REFRESH_COOKIE_NAME] as string | undefined);
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }
    const tokens =
      await this.backofficeAuthService.refreshTokens(refreshToken);
    this.setRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin logout (invalidate refresh token)' })
  async logout(
    @Req() req: BackofficeRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.backofficeAuthService.logout(req.user.sub);
    res.clearCookie(BO_REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.app.nodeEnv !== 'development',
      sameSite: 'strict',
      path: `/${this.app.backofficeApiPrefix}/auth/refresh`,
    });
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin profile' })
  @ApiOkResponse({ type: AdminResponseDto })
  getProfile(@Req() req: BackofficeRequest): Promise<AdminResponseDto> {
    return this.backofficeAuthService.getProfile(req.user.sub);
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(BO_REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: this.app.nodeEnv !== 'development',
      sameSite: 'strict',
      path: `/${this.app.backofficeApiPrefix}/auth/refresh`,
      maxAge: parseDurationMs(this.jwt.refreshExpiration),
    });
  }
}
