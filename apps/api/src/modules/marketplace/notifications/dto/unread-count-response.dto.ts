import { ApiProperty } from '@nestjs/swagger';

/** Badge count for `GET /me/notifications/unread-count` (TOV-174). Capped at 100 — render `>= 100` as "99+". */
export class UnreadCountResponseDto {
  @ApiProperty({
    description: "The caller's unread notification count, capped at 100 (a value of 100 means '100 or more').",
    example: 7,
    maximum: 100,
  })
  count!: number;
}
