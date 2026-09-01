import { Controller, Get, Patch, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ProfileService } from './profile.service';
import { UpdateMeProfileDto } from './dto/update-me-profile.dto';
import { MeProfileResponseDto } from './dto/me-profile-response.dto';

/**
 * Authenticated, owner-scoped `me` profile surface (TOV-30), served at `api/v1/me`. NOT `@Public()` — the
 * global AuthGuard runs and both routes are scoped to the JWT `sub`. PATCH validates the RAW body in the
 * service (422 `VALIDATION_FAILED` + `errors[]`), so it uses `@Req()` rather than `@Body()`.
 */
@ApiTags('me-profile')
@ApiBearerAuth()
@Controller('me')
export class MeProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Read the caller profile (identity + fields + active avatar URLs)' })
  getMine(@CurrentUser('sub') userId: string): Promise<MeProfileResponseDto> {
    return this.profile.getMyProfile(userId);
  }

  @Patch()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiBody({ type: UpdateMeProfileDto })
  @ApiOperation({ summary: 'Update optional profile fields; null clears; profileImageId activates an avatar' })
  update(
    @CurrentUser('sub') userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MeProfileResponseDto> {
    // Read the RAW body (no @Body DTO): the decorator-less UpdateMeProfileDto exists for Swagger only, and
    // the global whitelist pipe would 400 it. Validation + null-vs-absent presence happen in the service.
    const body = ((req.body as unknown) ?? {}) as Record<string, unknown>;
    return this.profile.updateProfile(userId, body);
  }
}
