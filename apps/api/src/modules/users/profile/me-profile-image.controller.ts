import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { ProfileService } from './profile.service';
import { ProfileCommitConcurrencyInterceptor } from './profile-commit-concurrency.interceptor';
import {
  CommitProfileImageDto,
  ProfileImageCommitResponseDto,
} from './dto/commit-profile-image.dto';
import { ProfileImageUploadResponseDto } from './dto/profile-image-upload-response.dto';
import { ProfileImageStatusResponseDto } from './dto/profile-image-status-response.dto';

/**
 * Authenticated, owner-scoped avatar lifecycle surface (TOV-30), served at `api/v1/me/profile-image`.
 * Split from the profile controller so the image-specific concerns (Idempotency-Key, no-store status poll)
 * are isolated. Both write endpoints require an `Idempotency-Key`.
 */
@ApiTags('me-profile-image')
@ApiBearerAuth()
@Controller('me/profile-image')
export class MeProfileImageController {
  constructor(private readonly profile: ProfileService) {}

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Mint a signed upload URL for a new avatar image (Idempotency-Key required)' })
  requestUpload(
    @CurrentUser('sub') userId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<ProfileImageUploadResponseDto> {
    return this.profile.requestUpload(userId, idempotencyKey);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(ProfileCommitConcurrencyInterceptor)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Confirm the upload, validate it, and queue derivative generation' })
  commit(
    @CurrentUser('sub') userId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: CommitProfileImageDto,
  ): Promise<ProfileImageCommitResponseDto> {
    return this.profile.commitUpload(userId, dto.profileImageId, idempotencyKey);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'Poll processing status of an uploaded image' })
  status(
    @CurrentUser('sub') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProfileImageStatusResponseDto> {
    return this.profile.getImageStatus(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Erase an uploaded image (purges public + private; clears the avatar if active)' })
  remove(
    @CurrentUser('sub') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.profile.deleteImage(userId, id);
  }
}
