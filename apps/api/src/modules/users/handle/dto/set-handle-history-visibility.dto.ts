import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Body for `PATCH /me/handle/history` (TOV-27). When `false`, the collector's public profile
 * (`GET /collectors/:handle`) returns `previousHandles: []` — the opt-out from the public "previously
 * known as" trail.
 */
export class SetHandleHistoryVisibilityDto {
  @ApiProperty({ example: true, description: 'Whether to show handle history on the public profile' })
  @IsBoolean()
  public!: boolean;
}
