import { ApiProperty } from '@nestjs/swagger';
import { HandleReason } from '../handle-format';

/**
 * Response for `GET /handles/check` (TOV-26). Always 200: invalid/reserved/taken all resolve to
 * `available: false` with a `reason`, so the picker UI renders one inline message without a second
 * response shape. `reason` reuses the shared {@link HandleReason} union (no re-inlined literals →
 * no drift). Invariant: `reason` is present iff `available` is false.
 */
export class CheckHandleResponseDto {
  @ApiProperty({ example: 'maya', description: 'The (trimmed) handle that was checked' })
  handle!: string;

  @ApiProperty({ example: false, description: 'Whether the handle can be claimed' })
  available!: boolean;

  @ApiProperty({
    required: false,
    enum: ['invalid_format', 'reserved', 'taken'],
    description: 'Why the handle is unavailable (omitted when available)',
  })
  reason?: HandleReason;
}
