import { Controller, Post, Body, Res, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigType } from '@nestjs/config';
import { Response } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { appConfig } from '@config/app.config';
import { Sep10Service } from './sep10.service';
import { Sep10ChallengeDto } from './dto/sep10-challenge.dto';
import { Sep10VerifyDto } from './dto/sep10-verify.dto';
import { Sep10ChallengeResponseDto } from './dto/sep10-challenge-response.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { setRefreshCookie } from './refresh-cookie';

@ApiTags('Auth')
@Public()
@Controller('auth/sep10')
export class Sep10Controller {
  constructor(
    private readonly sep10Service: Sep10Service,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'SEP-10: request a challenge transaction for a wallet to sign' })
  @ApiOkResponse({ type: Sep10ChallengeResponseDto })
  challenge(@Body() dto: Sep10ChallengeDto): Promise<Sep10ChallengeResponseDto> {
    return this.sep10Service.buildChallenge(dto.publicKey);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'SEP-10: verify a signed challenge and issue tokens' })
  @ApiOkResponse({ type: TokenResponseDto })
  async verify(
    @Body() dto: Sep10VerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const { accessToken, refreshToken } = await this.sep10Service.verify(dto.challengeTxXdr);
    setRefreshCookie(res, refreshToken, this.app);
    return { accessToken, refreshToken };
  }
}
