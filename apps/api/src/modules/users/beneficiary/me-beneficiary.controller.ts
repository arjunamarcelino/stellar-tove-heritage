import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { BeneficiaryService } from './beneficiary.service';
import { SetBeneficiaryDto } from './dto/set-beneficiary.dto';
import { BeneficiaryResponseDto } from './dto/beneficiary-response.dto';

/**
 * Authenticated, owner-scoped `me/beneficiary` surface (TOV-31, FR-01.10), served at
 * `api/v1/me/beneficiary`. NOT `@Public()` — the global AuthGuard runs and every route is scoped to the
 * JWT `sub`. All three verbs return `{ beneficiary, notice }`; POST is a full-replace upsert (200, not 201),
 * DELETE is an idempotent hard-delete.
 */
@ApiTags('me-beneficiary')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
@ApiTooManyRequestsResponse({ description: 'Per-identity rate limit exceeded.' })
@Controller('me/beneficiary')
export class MeBeneficiaryController {
  constructor(private readonly service: BeneficiaryService) {}

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: "Read the caller's beneficiary (beneficiary null if unset)" })
  @ApiOkResponse({ type: BeneficiaryResponseDto })
  getMine(@CurrentUser('sub') userId: string): Promise<BeneficiaryResponseDto> {
    return this.service.getBeneficiary(userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiBody({ type: SetBeneficiaryDto })
  @ApiOperation({ summary: 'Set/update the caller beneficiary (full-replace upsert; omitted optional → cleared)' })
  // @ApiOkResponse pins the response to 200 — @HttpCode(200) alone leaves Swagger documenting the @Post default 201.
  @ApiOkResponse({ type: BeneficiaryResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed (missing/blank name, bad email, bad G-address, over-length, unknown field).' })
  set(@CurrentUser('sub') userId: string, @Body() dto: SetBeneficiaryDto): Promise<BeneficiaryResponseDto> {
    return this.service.setBeneficiary(userId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: 'Clear the caller beneficiary (hard-delete; idempotent no-op when none)' })
  @ApiOkResponse({ type: BeneficiaryResponseDto })
  remove(@CurrentUser('sub') userId: string): Promise<BeneficiaryResponseDto> {
    return this.service.removeBeneficiary(userId);
  }
}
