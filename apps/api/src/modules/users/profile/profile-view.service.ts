import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { failHttp } from '@common/http/fail-http';
import { ErrorCode } from '@common/enums/error-code.enum';
import { USER_REPOSITORY, IUserRepository } from '../repositories/user-repository.interface';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from './repositories/profile-image-repository.interface';
import {
  PROFILE_PUBLIC_URL,
  IProfilePublicUrl,
} from './storage/profile-public-url.service';
import {
  PROFILE_DERIVATIVE_SPECS,
  profilePublicDerivativePath,
} from './constants/profile-image.constants';
import { MeProfileResponseDto, ProfileImageUrlsDto } from './dto/me-profile-response.dto';

const SIZE_BY_NAME = Object.fromEntries(PROFILE_DERIVATIVE_SPECS) as Record<
  'thumb' | 'card' | 'hero',
  number
>;

/**
 * Builds the profile view shared by `GET /v1/me` and `GET /v1/auth/profile` (TOV-30) — one source so the
 * two reads cannot drift. Neutral (imported by both the public profile module and AuthModule); the user
 * arrives by id. `profileImage` resolves to public derivative URLs only when the active image is `ready`
 * (its public copies exist because activation publishes them); otherwise null.
 */
@Injectable()
export class ProfileViewService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PROFILE_IMAGE_REPOSITORY) private readonly images: IProfileImageRepository,
    @Inject(PROFILE_PUBLIC_URL) private readonly publicUrl: IProfilePublicUrl,
  ) {}

  async buildForUser(userId: string): Promise<MeProfileResponseDto> {
    const profile = await this.users.findProfileFieldsByUserId(userId);
    if (!profile) {
      throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    }
    const image = await this.resolveActiveImageUrls(userId, profile.profileImageId);
    return MeProfileResponseDto.build(profile, image);
  }

  private async resolveActiveImageUrls(
    userId: string,
    profileImageId: string | null,
  ): Promise<ProfileImageUrlsDto | null> {
    if (!profileImageId) return null;
    const img = await this.images.findOwned(profileImageId, userId);
    if (!img || img.status !== 'ready') return null;
    const url = (size: number): string =>
      this.publicUrl.getPublicUrl(profilePublicDerivativePath(img.id, size));
    return {
      thumbUrl: url(SIZE_BY_NAME.thumb),
      cardUrl: url(SIZE_BY_NAME.card),
      heroUrl: url(SIZE_BY_NAME.hero),
    };
  }
}
