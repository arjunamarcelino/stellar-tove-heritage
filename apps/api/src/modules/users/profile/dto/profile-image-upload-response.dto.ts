import { ApiProperty } from '@nestjs/swagger';

/** The direct-to-storage PUT target the client uploads bytes to (Supabase signed upload URL). */
export class ProfileUploadTargetDto {
  @ApiProperty({ example: 'PUT' }) method!: string;
  @ApiProperty({ description: 'Signed URL to PUT the raw bytes to.' }) url!: string;
  @ApiProperty({ description: 'Upload token (for supabase-js uploadToSignedUrl).' }) token!: string;
  @ApiProperty({ description: 'Object path within the bucket.' }) path!: string;
  @ApiProperty({
    type: () => Object,
    description: "Headers to send with the PUT (Content-Type = the file's real MIME; x-upsert:false).",
  })
  headers!: Record<string, string>;
}

/** `POST /me/profile-image` response (TOV-30). */
export class ProfileImageUploadResponseDto {
  @ApiProperty({ format: 'uuid' }) profileImageId!: string;
  @ApiProperty({ type: () => ProfileUploadTargetDto }) upload!: ProfileUploadTargetDto;
}
