import { ApiProperty } from '@nestjs/swagger';

/**
 * Public collector profile (TOV-27, FR-01.06). Pseudonymous — deliberately no id / email / wallet.
 * `previousHandles` is newest-first, deduped by canonical, excluding the current handle (empty when the
 * collector opted out of a public history). `createdAt` is the member-since DATE (UTC `YYYY-MM-DD`) — date
 * granularity only, to avoid exposing a millisecond signup fingerprint on this public surface.
 */
export class CollectorProfileResponseDto {
  @ApiProperty({ example: 'Maya', description: 'The collector current display handle' })
  handle!: string;

  @ApiProperty({
    type: [String],
    example: ['earlyname'],
    description: 'Previously-held handles, newest-first (empty if none or history is hidden)',
  })
  previousHandles!: string[];

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-01-15',
    description: 'Account member-since date (UTC, YYYY-MM-DD)',
  })
  createdAt!: string;
}
