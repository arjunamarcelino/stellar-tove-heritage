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

  @Post('register/begin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Passkey: start WebAuthn registration (issue options)' })
  @ApiOkResponse({ type: PasskeyRegistrationOptionsResponseDto })
  begin(@Body() dto: PasskeyRegisterBeginDto): Promise<PasskeyRegistrationOptionsResponseDto> {
    return this.passkeyService.begin(dto.email);
  }

  @Post('register/finish')
  @HttpCode(HttpStatus.CREATED)
  // Deploy-bearing -> intentionally tighter than SEP-10's 10/min. 201 models the
  // email /register route (account creation), not SEP-10 verify (200).
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Passkey: verify attestation, deploy smart wallet, issue tokens' })
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
