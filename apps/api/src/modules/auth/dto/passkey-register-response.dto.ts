import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for a successful passkey registration (`register/finish`). Extends the
 * standard token pair with the deployed embedded smart-wallet address so the client
 * can surface it immediately (no extra chain call — the backend already has it).
 *
 * NOTE: unlike the shared `TokenResponseDto`, `refreshToken` is REQUIRED here — a
 * successful registration always mints both tokens (fresh + idempotent-replay both go
 * through `issueTokensForUser`), and a BFF that copies them into its own cookies relies
 * on it. There is no 201 path that omits it.
 */
export class PasskeyRegisterResponseDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTAiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJpYXQiOjE3MTcxNDQwMDAsImV4cCI6MTcxNzE0NDkwMH0.abc123',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Refresh token (also set as an HttpOnly cookie). Always present on a 201.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTAiLCJ0eXBlIjoicmVmcmVzaCIsImlhdCI6MTcxNzE0NDAwMCwiZXhwIjoxNzE3NzQ4ODAwfQ.xyz789',
  })
  refreshToken!: string;

  @ApiProperty({
    description: 'Deployed embedded smart-wallet contract address (Soroban C-StrKey).',
    example: 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME',
  })
  contractAddress!: string;
}
