import { ApiProperty } from '@nestjs/swagger';
import { SocialLinks } from '../constants/social-links.constant';
import { UserProfileFields } from '../profile.types';

/** Public URLs for the active avatar's derivatives (all present together, or the whole object is null). */
export class ProfileImageUrlsDto {
  @ApiProperty() thumbUrl!: string;
  @ApiProperty() cardUrl!: string;
  @ApiProperty() heroUrl!: string;
}

/**
 * `GET /me` + `PATCH /me` response (TOV-30). Built field-by-field (never spreads the entity, so storage
 * paths can't leak). `profileImage` is null unless an avatar is currently ACTIVATED (its derivatives are
 * public). Shared with `GET /auth/profile` via `ProfileViewService` so the two reads cannot drift.
 */
export class MeProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ nullable: true }) handle!: string | null;
  @ApiProperty({ nullable: true }) bio!: string | null;
  @ApiProperty({ nullable: true }) statement!: string | null;
  @ApiProperty({ nullable: true, type: () => Object }) socialLinks!: SocialLinks | null;
  @ApiProperty({ nullable: true, type: () => ProfileImageUrlsDto })
  profileImage!: ProfileImageUrlsDto | null;

  static build(profile: UserProfileFields, image: ProfileImageUrlsDto | null): MeProfileResponseDto {
    const dto = new MeProfileResponseDto();
    dto.id = profile.id;
    dto.email = profile.email;
    dto.handle = profile.handle;
    dto.bio = profile.bio;
    dto.statement = profile.statement;
    dto.socialLinks = profile.socialLinks;
    dto.profileImage = image;
    return dto;
  }
}
