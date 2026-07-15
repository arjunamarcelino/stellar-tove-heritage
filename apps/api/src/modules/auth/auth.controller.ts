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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigType } from '@nestjs/config';
import { Response, Request } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { appConfig } from '@config/app.config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { REFRESH_COOKIE_NAME, setRefreshCookie, clearRefreshCookie } from './refresh-cookie';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Register a new account' })
  @ApiCreatedResponse({ type: TokenResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const { accessToken, refreshToken } = await this.authService.register(dto);
    setRefreshCookie(res, refreshToken, this.app);
    return { accessToken, refreshToken };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Login with credentials' })
  @ApiOkResponse({ type: TokenResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const { accessToken, refreshToken } = await this.authService.login(dto);
    setRefreshCookie(res, refreshToken, this.app);
    return { accessToken, refreshToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Refresh tokens' })
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const refreshToken =
      dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }
    const tokens = await this.authService.refreshTokens(refreshToken);
    setRefreshCookie(res, tokens.refreshToken, this.app);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout (invalidate refresh token)' })
  async logout(
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(userId);
    clearRefreshCookie(res, this.app);
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ type: ProfileResponseDto })
  getProfile(@CurrentUser() user: JwtPayload): Promise<ProfileResponseDto> {
    return this.authService.getProfile(user.sub);
  }
}
