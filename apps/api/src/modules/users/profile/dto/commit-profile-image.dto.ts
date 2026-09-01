import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { ProfileImageStatus } from '../constants/profile-image.constants';

/** `POST /me/profile-image/commit` body. A bad UUID → 400 (the AC's 422 shape is only for PATCH fields). */
export class CommitProfileImageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  profileImageId!: string;
}

/** `POST /me/profile-image/commit` response — derivatives are queued; poll status until ready. */
export class ProfileImageCommitResponseDto {
  @ApiProperty({ format: 'uuid' }) profileImageId!: string;
  @ApiProperty({ enum: ['pending', 'processing', 'ready', 'failed'] }) status!: ProfileImageStatus;
}
