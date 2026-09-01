import { ApiProperty } from '@nestjs/swagger';
import { ProfileImageStatus } from '../constants/profile-image.constants';

/** `GET /me/profile-image/:id` status-poll response (TOV-30). Always eventually terminal (ready|failed). */
export class ProfileImageStatusResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['pending', 'processing', 'ready', 'failed'] }) status!: ProfileImageStatus;
}
