import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { Sep10ChallengeResponseDto } from '@modules/auth/dto/sep10-challenge-response.dto';
import { WalletsService } from '../wallets.service';
import { ExportWalletDto } from '../export/dto/export-wallet.dto';
import { ExportWalletResponseDto } from '../export/dto/export-wallet-response.dto';
import { SubmitExportDto } from '../export/dto/submit-export.dto';
import { SubmitExportResponseDto } from '../export/dto/submit-export-response.dto';
import { ExportStatusResponseDto } from '../export/dto/export-status-response.dto';
import { WalletExportService } from '../export/wallet-export.service';
import { MeWalletDto } from './dto/me-wallet.dto';
import { DeleteWalletResponseDto } from './dto/delete-wallet-response.dto';
import { AddWalletDto } from './dto/add-wallet.dto';
import { AddWalletChallengeDto } from './dto/add-wallet-challenge.dto';
import { MeWalletsService } from './me-wallets.service';

/**
 * Authenticated, owner-scoped `me/wallets` surface, served at `api/v1/me/wallets...`. NOT `@Public()` —
 * the global AuthGuard runs and every route is owner-scoped to the JWT `sub`. Owns both the multi-wallet
 * identity verbs (list/add/remove + the user-bound challenge, TOV-24) and the embedded-wallet export flow
 * (`:id/export*`, TOV-40) — kept in ONE controller so `DELETE :id` and `GET :id/export` share NestJS's
 * intra-controller static-before-`:param` route ordering. Throttled per user.
 */
@ApiTags('me-wallets')
@ApiBearerAuth()
@Controller('me/wallets')
export class MeWalletsController {
  constructor(
    private readonly exportService: WalletExportService,
    private readonly walletsService: WalletsService,
    private readonly meWalletsService: MeWalletsService,
  ) {}

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: "List the caller's wallets (kind, publicKey, isPrimary, createdAt, exported)" })
  async list(@CurrentUser('sub') userId: string): Promise<MeWalletDto[]> {
    const wallets = await this.walletsService.listOwnedWallets(userId);
    return wallets.map((w) => MeWalletDto.fromEntity(w));
  }

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Issue a user-bound SEP-10 challenge to bind a new BYOW wallet' })
  issueChallenge(
    @CurrentUser('sub') userId: string,
    @Body() dto: AddWalletChallengeDto,
  ): Promise<Sep10ChallengeResponseDto> {
    return this.meWalletsService.issueChallenge(userId, dto.publicKey);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Bind a new BYOW wallet with a signed challenge (Idempotency-Key required)' })
  add(
    @CurrentUser('sub') userId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: AddWalletDto,
  ): Promise<MeWalletDto> {
    return this.meWalletsService.add(userId, idempotencyKey, dto);
  }

  @Post(':id/primary')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Set an owned wallet as the primary settlement wallet' })
  setPrimary(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) walletId: string,
  ): Promise<MeWalletDto> {
    return this.meWalletsService.setPrimary(userId, walletId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Remove (soft-unbind) an owned wallet — if primary, auto-promotes a sibling and returns the new primary',
  })
  remove(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) walletId: string,
  ): Promise<DeleteWalletResponseDto> {
    return this.meWalletsService.remove(userId, walletId);
  }

  @Post(':id/export')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Initiate/resume an export: returns per-holding challenges to sign' })
  initiate(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) walletId: string,
    @Body() dto: ExportWalletDto,
  ): Promise<ExportWalletResponseDto> {
    return this.exportService.initiate(userId, walletId, dto);
  }

  @Post(':id/export/submit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Submit signed assertions for the export holdings (verified server-side)' })
  submit(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) walletId: string,
    @Body() dto: SubmitExportDto,
  ): Promise<SubmitExportResponseDto> {
    return this.exportService.submit(userId, walletId, dto);
  }

  @Get(':id/export/status')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Reconciliation status for the export (explicit pending/submitting state)' })
  status(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) walletId: string,
  ): Promise<ExportStatusResponseDto> {
    return this.exportService.status(userId, walletId);
  }
}
