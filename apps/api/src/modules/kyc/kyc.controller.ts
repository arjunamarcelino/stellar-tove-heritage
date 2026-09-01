import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { KycService } from './kyc.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { KycSubmissionResponseDto } from './dto/kyc-submission-response.dto';
import { KycStatusResponseDto } from './dto/kyc-status-response.dto';
import { WhitelistStatusResponseDto } from './dto/whitelist-status-response.dto';
import { validateKycFiles, KYC_MAX_FILE_BYTES } from './kyc-file.validator';
import { KycConcurrencyInterceptor } from './kyc-concurrency.interceptor';

/**
 * Authenticated, owner-scoped KYC surface (TOV-28), served at `api/v1/me/kyc...`. NOT `@Public()` — the
 * global AuthGuard runs and every route is scoped to the JWT `sub`. Route-throttled tighter than the global
 * default (5/hour) since the submit endpoint accepts ~40MB of multipart.
 */
@ApiTags('me-kyc')
@ApiBearerAuth()
@Controller('me/kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('submissions')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Submit KYC documents (4 files, Idempotency-Key required) → 202 pending_review' })
  @UseInterceptors(
    // Concurrency gate FIRST — rejects over-capacity requests (503) before Multer buffers the ~40MB body.
    KycConcurrencyInterceptor,
    FileFieldsInterceptor(
      [
        { name: 'gov_id_front', maxCount: 1 },
        { name: 'gov_id_back', maxCount: 1 },
        { name: 'proof_of_address', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      { limits: { fileSize: KYC_MAX_FILE_BYTES, files: 4, fields: 10, parts: 20 } },
    ),
  )
  submit(
    @CurrentUser('sub') userId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: SubmitKycDto,
    @UploadedFiles() files: Record<string, Express.Multer.File[] | undefined>,
  ): Promise<KycSubmissionResponseDto> {
    const validated = validateKycFiles(files);
    return this.kycService.submit(userId, idempotencyKey, dto, validated);
  }

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: "Read the caller's KYC status + latest submission metadata" })
  getStatus(@CurrentUser('sub') userId: string): Promise<KycStatusResponseDto> {
    return this.kycService.getStatus(userId);
  }

  @Get('status')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: "Read the caller's whitelist status (5 states) — FR-01.08 status card" })
  getWhitelistStatus(@CurrentUser('sub') userId: string): Promise<WhitelistStatusResponseDto> {
    return this.kycService.getWhitelistStatus(userId);
  }
}
