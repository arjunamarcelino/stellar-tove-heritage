import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

/**
 * Body for the unified email-first `POST /auth/passkey/begin`. Only the email is needed — the backend
 * decides login vs signup from whether that email already has a passkey account.
 */
export class PasskeyBeginDto {
  @ApiProperty({
    description: 'Email to begin a passkey login (if it exists) or signup (if it is new).',
    example: 'collector@example.com',
  })
  // Normalize once at the boundary so the persisted challenge email, the finish binding compare,
  // and any created user.email all agree (citext + JS compares).
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;
}
