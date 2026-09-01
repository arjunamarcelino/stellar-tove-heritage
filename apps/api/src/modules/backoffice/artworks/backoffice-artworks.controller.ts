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
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { AdminRole } from '@common/enums/admin-role.enum';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ApiPaginatedResponse } from '@common/decorators/api-paginated-response.decorator';
import { BackofficeArtworksService } from './backoffice-artworks.service';
import { FractionalizeArtworkDto } from './dto/fractionalize-artwork.dto';
import { FractionalizationResponseDto } from './dto/fractionalization-response.dto';
import { ArtworkQueryDto } from './dto/artwork-query.dto';
import { ArtworkListItemDto } from './dto/artwork-list-item.dto';
import { ArtworkDetailDto } from './dto/artwork-detail.dto';
import { OfferingPreviewQueryDto } from './dto/offering-preview-query.dto';
import { OfferingPreviewDto } from './dto/offering-preview.dto';

@ApiTags('Backoffice Artworks')
@Controller('artworks')
@ApiBearerAuth()
// SECURITY: class-level @Public() only bypasses the global AuthGuard; BackofficeGuard still authenticates.
// Never add a handler-level @Public() on this money-adjacent route — it would disable admin auth.
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.ADMIN, AdminRole.SUPERADMIN)
export class BackofficeArtworksController {
  constructor(private readonly service: BackofficeArtworksService) {}

  @Get()
  @ApiOperation({ summary: 'List artworks (admin, paginated; fractionalization-relevant states by default)' })
  @ApiPaginatedResponse(ArtworkListItemDto)
  @ApiBadRequestResponse({ description: 'Invalid query params (out-of-enum status, or page/limit out of range)' })
  @ApiUnauthorizedResponse({ description: 'Missing or non-admin bearer token' })
  listArtworks(@Query() query: ArtworkQueryDto): Promise<PaginatedResponseDto<ArtworkListItemDto>> {
    return this.service.listArtworks(query);
  }

  @Get(':id')
  // no-store: the detail now embeds mutable offering-planning state (activeOffering status/window).
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get artwork detail + fractionalization projection + active offering (admin)' })
  @ApiOkResponse({ type: ArtworkDetailDto })
  @ApiBadRequestResponse({ description: 'Malformed UUID' })
  @ApiNotFoundResponse({ description: 'ARTWORK_NOT_FOUND (unknown or soft-deleted)' })
  @ApiUnauthorizedResponse({ description: 'Missing or non-admin bearer token' })
  getArtwork(@Param('id', ParseUUIDPipe) id: string): Promise<ArtworkDetailDto> {
    return this.service.getArtwork(id);
  }

  @Get(':id/offering-preview')
  // Interactive polling from the plan form (UI debounces); dedicated ceiling above the read default.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Live offering-planning preview: public float + estimated raise range (admin)' })
  @ApiOkResponse({ type: OfferingPreviewDto })
  @ApiBadRequestResponse({ description: 'Malformed UUID, or band supplied partially / non-integer' })
  @ApiNotFoundResponse({ description: 'ARTWORK_NOT_FOUND' })
  @ApiConflictResponse({ description: 'OFFERING_ARTWORK_NOT_FRACTIONALIZED (no deployed fraction contract)' })
  @ApiUnprocessableEntityResponse({ description: 'OFFERING_BAND_INVALID | OFFERING_NO_FLOAT' })
  @ApiUnauthorizedResponse({ description: 'Missing or non-admin bearer token' })
  offeringPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: OfferingPreviewQueryDto,
  ): Promise<OfferingPreviewDto> {
    return this.service.offeringPreview(id, query);
  }

  @Post(':id/fractionalize')
  @HttpCode(HttpStatus.ACCEPTED)
  // Bound admin-triggered on-chain deploys: the identity throttler falls back to IP for admin tokens,
  // so an explicit per-route ceiling caps a leaked-token queue flood.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Deploy the per-artwork FractionToken (admin, idempotent, async)' })
  @ApiAcceptedResponse({ type: FractionalizationResponseDto })
  fractionalize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FractionalizeArtworkDto,
    @CurrentUser('sub') adminSub: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<FractionalizationResponseDto> {
    return this.service.fractionalize(id, dto, adminSub, idempotencyKey);
  }

  @Get(':id/fractionalization')
  @ApiOperation({ summary: 'Read the FractionToken deploy status for an artwork (admin)' })
  @ApiOkResponse({ type: FractionalizationResponseDto })
  getStatus(@Param('id', ParseUUIDPipe) id: string): Promise<FractionalizationResponseDto> {
    return this.service.getStatus(id);
  }
}
