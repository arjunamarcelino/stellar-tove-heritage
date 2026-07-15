import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { BuildTransferDto } from './dto/build-transfer.dto';
import { BuildTransferResponseDto } from './dto/build-transfer-response.dto';
import { SubmitTransferDto } from './dto/submit-transfer.dto';
import { SubmitTransferResponseDto } from './dto/submit-transfer-response.dto';
import { WalletTransferService } from './wallet-transfer.service';

/**
 * Authenticated passkey-signed transfer surface (TOV-22), served at `api/v1/wallet/...` via
 * RouterModule. NOT `@Public()`, so the global AuthGuard runs and the `from` wallet is owner-scoped
 * to the JWT `sub`. Throttled tighter than the global default (money surface).
 */
@ApiTags('wallet-transfer')
@ApiBearerAuth()
@Controller('wallet')
export class WalletTransferController {
  constructor(private readonly transferService: WalletTransferService) {}

  @Post('transfer/build')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Build an unsigned USDC transfer + the passkey challenge to sign' })
  build(
    @CurrentUser('sub') userId: string,
    @Body() dto: BuildTransferDto,
  ): Promise<BuildTransferResponseDto> {
    return this.transferService.build(userId, dto);
  }

  @Post('transfer/submit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Submit a built transfer with the passkey assertion (verified before submit)' })
  submit(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitTransferDto,
  ): Promise<SubmitTransferResponseDto> {
    return this.transferService.submit(userId, dto);
  }
}
