import { Controller, Post, Body, Res, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigType } from '@nestjs/config';
import { Response } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { appConfig } from '@config/app.config';
import { PasskeyService } from './passkey.service';
import { PasskeyRegisterBeginDto } from './dto/passkey-register-begin.dto';
import { PasskeyRegisterFinishDto } from './dto/passkey-register-finish.dto';
import { PasskeyBeginDto } from './dto/passkey-begin.dto';
import { PasskeyBeginResponseDto } from './dto/passkey-begin-response.dto';
import { PasskeyFinishDto } from './dto/passkey-finish.dto';
import { PasskeyRegistrationOptionsResponseDto } from './dto/passkey-registration-options-response.dto';
import { PasskeyRegisterResponseDto } from './dto/passkey-register-response.dto';
import { setRefreshCookie } from './refresh-cookie';

@ApiTags('Auth')
@Public()
@Controller('auth/passkey')
export class PasskeyController {
  constructor(
    private readonly passkeyService: PasskeyService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  @Post('begin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: 'Passkey: email-first begin — auto-detects login vs signup, returns options + mode',
  })
  @ApiOkResponse({ type: PasskeyBeginResponseDto })
  beginAuto(@Body() dto: PasskeyBeginDto): Promise<PasskeyBeginResponseDto> {
    return this.passkeyService.beginAuto(dto.email);
  }

  @Post('finish')
  // 200 for BOTH login and signup: tokens are returned either way and the FE already knows the mode
  // from begin, so a dynamic 200/201 (which fights Nest's metadata status under @Res passthrough) buys
  // nothing. The refresh cookie is set the same for both.
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: 'Passkey: email-first finish — verify assertion (login) or attestation (signup), issue tokens',
  })
  @ApiOkResponse({ type: PasskeyRegisterResponseDto })
  async finishAuto(
    @Body() dto: PasskeyFinishDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PasskeyRegisterResponseDto> {
    const { accessToken, refreshToken, contractAddress } =
      await this.passkeyService.finishAuto(dto);
    setRefreshCookie(res, refreshToken, this.app);
    return { accessToken, refreshToken, contractAddress };
  }

  @Post('register/begin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: 'Passkey: start WebAuthn registration (issue options) [deprecated: use /auth/passkey/begin]',
    deprecated: true,
  })
  @ApiOkResponse({ type: PasskeyRegistrationOptionsResponseDto })
  begin(@Body() dto: PasskeyRegisterBeginDto): Promise<PasskeyRegistrationOptionsResponseDto> {
    return this.passkeyService.begin(dto.email);
  }

  @Post('register/finish')
  @HttpCode(HttpStatus.CREATED)
  // Deploy-bearing -> intentionally tighter than SEP-10's 10/min. 201 models the
  // email /register route (account creation), not SEP-10 verify (200).
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary:
      'Passkey: verify attestation, deploy smart wallet, issue tokens [deprecated: use /auth/passkey/finish]',
    deprecated: true,
  })
  @ApiCreatedResponse({ type: PasskeyRegisterResponseDto })
  async finish(
    @Body() dto: PasskeyRegisterFinishDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PasskeyRegisterResponseDto> {
    const { accessToken, refreshToken, contractAddress } = await this.passkeyService.finish(dto);
    setRefreshCookie(res, refreshToken, this.app);
    return { accessToken, refreshToken, contractAddress };
  }
}
