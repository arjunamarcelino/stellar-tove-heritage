import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Query for `GET /handles/check?handle=…` (TOV-26). A MISSING `handle` param fails `@IsString()` →
 * 400 (malformed request). A present-but-invalid value (empty/bad format) passes here and is answered
 * 200 `{ available: false, reason: 'invalid_format' }` by the service — the two are deliberately distinct.
 */
export class CheckHandleQueryDto {
  @ApiProperty({ example: 'maya', description: 'Handle to check for availability' })
  @IsString()
  handle!: string;
}
