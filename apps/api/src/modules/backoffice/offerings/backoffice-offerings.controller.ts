import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { ApiPaginatedResponse } from '@common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { BackofficeOfferingsService } from './backoffice-offerings.service';
import { BackofficeOfferingSettleService } from './backoffice-offering-settle.service';
import { CreateOfferingDto } from './dto/create-offering.dto';
import { OfferingResponseDto } from './dto/offering-response.dto';
import { ApproveOfferingResponseDto } from './dto/approve-offering-response.dto';
import { OfferingDetailDto } from './dto/offering-detail.dto';
import { OfferingListQueryDto } from './dto/offering-list.query.dto';
import { ClearingPreviewDto } from './dto/clearing-preview.dto';
import { SettleOfferingResponseDto } from './dto/settle-offering-response.dto';

@ApiTags('Backoffice Offerings')
@Controller('offerings')
@ApiBearerAuth()
// SECURITY: class-level @Public() only bypasses the global AuthGuard; BackofficeGuard still authenticates.
// Never add a handler-level @Public() on this money-adjacent route — it would disable admin auth.
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.ADMIN, AdminRole.SUPERADMIN)
export class BackofficeOfferingsController {
  constructor(
    private readonly service: BackofficeOfferingsService,
    private readonly settleService: BackofficeOfferingSettleService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // The identity throttler falls back to IP for admin tokens (backoffice secret ≠ user secret), so this is a
  // per-IP ceiling, not per-admin — a coarse flood backstop.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Plan a primary Offering for a fractionalized artwork (admin, idempotent)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: OfferingResponseDto })
  create(
    @Body() dto: CreateOfferingDto,
    @CurrentUser('sub') adminSub: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<OfferingResponseDto> {
    return this.service.create(dto, adminSub, idempotencyKey);
  }

  // Static route declared BEFORE ':id' so the param route can't shadow it.
  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List offerings (approval work-queue) — paginated, status-filterable' })
  @ApiPaginatedResponse(OfferingDetailDto)
  list(
    @Query() query: OfferingListQueryDto,
    @CurrentUser('sub') adminSub: string,
  ): Promise<PaginatedResponseDto<OfferingDetailDto>> {
    return this.service.list(query, adminSub);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve an offering (app-level 2-of-3 quorum; deploys escrow on quorum)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ApproveOfferingResponseDto })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') adminSub: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<ApproveOfferingResponseDto> {
    return this.service.approve(id, adminSub, idempotencyKey);
  }

  // Static-suffix routes declared BEFORE ':id' so the param route can't shadow them.
  @Get(':id/clearing-preview')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Dry-run the uniform-price clearing (P + allocations) WITHOUT settling (admin)' })
  @ApiOkResponse({ type: ClearingPreviewDto })
  clearingPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') adminSub: string,
  ): Promise<ClearingPreviewDto> {
    return this.settleService.previewClearing(id, adminSub);
  }

  @Post(':id/settle')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Settle a fully-subscribed offering at the uniform clearing price (admin, async)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: SettleOfferingResponseDto })
  settle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') adminSub: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SettleOfferingResponseDto> {
    return this.settleService.settle(id, adminSub, idempotencyKey);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read one offering (approval + escrow state; 202-poll target)' })
  @ApiOkResponse({ type: OfferingDetailDto })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') adminSub: string,
  ): Promise<OfferingDetailDto> {
    return this.service.getOne(id, adminSub);
  }
}
