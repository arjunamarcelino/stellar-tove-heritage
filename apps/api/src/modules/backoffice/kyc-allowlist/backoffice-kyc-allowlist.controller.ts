import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiHeader, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { AdminJwtPayload } from '@common/interfaces/jwt-payload.interface';
import { BackofficeKycAllowlistService } from './backoffice-kyc-allowlist.service';
import { KycAllowlistBatchDto } from './dto/kyc-allowlist-batch.dto';
import { KycAllowlistResponseDto } from './dto/kyc-allowlist-response.dto';
import { KycAllowlistStatusResponseDto } from './dto/kyc-allowlist-status-response.dto';
import { ParseStrKeyAddressPipe } from './pipes/parse-strkey-address.pipe';

@ApiTags('Backoffice KYC Allowlist')
@Controller('kyc/allowlist')
@ApiBearerAuth()
// SECURITY: class-level @Public() only bypasses the global AuthGuard; BackofficeGuard still authenticates.
// Never add a handler-level @Public() on this route — it grants/revokes on-chain spendability.
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.ADMIN, AdminRole.SUPERADMIN)
export class BackofficeKycAllowlistController {
  constructor(private readonly service: BackofficeKycAllowlistService) {}

  @Post()
  @HttpCode(HttpStatus.OK) // 200 (processed, per-item status) — not 201; 409 is thrown for all-noop.
  // SECURITY: UserAwareThrottlerGuard now keys admin tokens per-admin `sub` (via the backoffice secret,
  // todo 268), so this ceiling is a per-admin budget (IP fallback only for anonymous/invalid tokens). Kept
  // deliberately tight (10/min) for this high-privilege on-chain-write route; each request can carry up to
  // KYC_ALLOWLIST_MAX_BATCH on-chain mutations. Volume alerting remains a complementary control.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Batch add/remove Collector wallets on the on-chain KYC allowlist (admin, idempotent)',
    description:
      'Accepts both smart-wallet contract addresses (C…) and BYOW classic account addresses (G…, TOV-243). ' +
      'Adding an external G-address lets a Collector receive FractionTokens on their own settlement wallet.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Required; same key replays the stored result' })
  @ApiOkResponse({ type: KycAllowlistResponseDto, description: '200 with per-item status (confirmed | pending | failed | noop | deferred)' })
  @ApiResponse({ status: 400, description: 'Missing/invalid Idempotency-Key, or DTO validation failure' })
  @ApiResponse({ status: 401, description: 'Missing/invalid admin bearer token' })
  @ApiResponse({ status: 403, description: 'A remove item, or adding an external BYOW (G…) wallet, requires the superadmin role' })
  @ApiResponse({ status: 409, description: 'Every item is a no-op (KYC_ALLOWLIST_ALL_NOOP), or a request with this key is still in-flight' })
  @ApiResponse({ status: 422, description: 'Batch over the configured max, or Idempotency-Key reused with a different batch' })
  processBatch(
    @Body() dto: KycAllowlistBatchDto,
    @CurrentUser() admin: AdminJwtPayload,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<KycAllowlistResponseDto> {
    return this.service.process(dto, admin.sub, admin.role, idempotencyKey);
  }

  @Get(':wallet')
  // Own, generous ceiling (60/min) vs the write's 10/min: a low-risk read backing a UI status pill must not
  // exhaust the tight write limit. Keyed per-admin `sub` (todo 268), IP fallback only for anonymous callers.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store') // security-adjacent status — never serve stale
  @ApiOperation({
    summary: "Read a wallet's advisory KYC-allowlist status from the mirror (admin, read-only)",
    description:
      'Returns the advisory `kyc_allowlist_state` mirror — eventually-consistent and display-only, NOT an ' +
      'authorization decision. A valid StrKey always yields 200: a never-seen wallet is `{ isAllowed:false }`, ' +
      'not 404 (404 is intentionally NOT part of this contract, so a downed route is distinguishable). Beyond ' +
      '`isAllowed`, the presence of provenance (`lastAction`/`updatedAt` non-null) reveals whether a wallet has ' +
      'ever been processed and when — admin-only, on-chain-public data, but note the enumeration signal.',
  })
  @ApiParam({ name: 'wallet', example: 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA', description: 'Collector wallet StrKey: BYOW account (G…, TOV-243) or smart-wallet contract (C…)' })
  // A never-seen wallet is 200 { isAllowed:false }, NOT 404 — lets the UI distinguish "not on the list" from
  // "endpoint unavailable" (404/5xx → pill = Unknown). 404 is intentionally NOT part of this contract.
  @ApiOkResponse({ type: KycAllowlistStatusResponseDto, description: '200 for any valid StrKey; never-seen → isAllowed:false (not 404)' })
  @ApiResponse({ status: 400, description: 'wallet is not a valid Stellar account (G…) or contract (C…) StrKey (VALIDATION_FAILED)' })
  @ApiResponse({ status: 401, description: 'Missing/invalid admin bearer token' })
  getStatus(
    @Param('wallet', ParseStrKeyAddressPipe) wallet: string,
    @CurrentUser() admin: AdminJwtPayload,
  ): Promise<KycAllowlistStatusResponseDto> {
    return this.service.getStatus(wallet, admin.sub);
  }
}
