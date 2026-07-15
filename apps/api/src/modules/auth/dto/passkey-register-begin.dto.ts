import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class PasskeyRegisterBeginDto {
  @ApiProperty({
    description: 'Email to register the passkey account under (must be unused).',
    example: 'collector@example.com',
  })
  // Normalize once at the boundary so the persisted challenge email, the finish
  // binding compare, and the created user.email all agree (citext + JS compares).
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;
}
