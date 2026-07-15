import { ApiProperty } from '@nestjs/swagger';

/** Response for `GET /me/handle` (TOV-26). `handle` is null when the collector has not claimed one. */
export class MyHandleResponseDto {
  @ApiProperty({ example: 'Maya', nullable: true, description: "The caller's current handle, or null" })
  handle!: string | null;
}
