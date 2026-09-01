import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { StageProgressDto } from '@modules/stages/dto/stage-progress.dto';
import { SocialLinks } from '@modules/users/profile/constants/social-links.constant';
import {
  MeProfileResponseDto,
  ProfileImageUrlsDto,
} from '@modules/users/profile/dto/me-profile-response.dto';

export class ProfileResponseDto extends UserResponseDto {
  @ApiPropertyOptional({ type: StageProgressDto, nullable: true })
  currentStage!: StageProgressDto | null;

  // TOV-30 profile fields — same values as GET /v1/me (built by the shared ProfileViewService).
  @ApiProperty({ nullable: true }) bio!: string | null;
  @ApiProperty({ nullable: true }) statement!: string | null;
  @ApiProperty({ nullable: true, type: () => Object }) socialLinks!: SocialLinks | null;
  @ApiProperty({ nullable: true, type: () => ProfileImageUrlsDto })
  profileImage!: ProfileImageUrlsDto | null;

  static create(params: {
    user: UserResponseDto;
    currentStage: StageProgressDto | null;
    profileView: MeProfileResponseDto;
  }): ProfileResponseDto {
    const dto = new ProfileResponseDto();
    dto.id = params.user.id;
    dto.email = params.user.email;
    dto.firstName = params.user.firstName;
    dto.lastName = params.user.lastName;
    dto.isActive = params.user.isActive;
    dto.createdAt = params.user.createdAt;
    dto.currentStage = params.currentStage;
    dto.bio = params.profileView.bio;
    dto.statement = params.profileView.statement;
    dto.socialLinks = params.profileView.socialLinks;
    dto.profileImage = params.profileView.profileImage;
    return dto;
  }
}
