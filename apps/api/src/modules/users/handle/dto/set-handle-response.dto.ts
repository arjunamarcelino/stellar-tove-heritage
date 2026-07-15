import { ApiProperty } from '@nestjs/swagger';

/** Response for `POST /me/handle` (TOV-26). `handleCanonical` is the lowercase uniqueness key. */
export class SetHandleResponseDto {
  @ApiProperty({ example: 'Maya', description: 'The stored display handle (collector-typed casing)' })
  handle!: string;

  @ApiProperty({ example: 'maya', description: 'Lowercase canonical form (the global uniqueness key)' })
  handleCanonical!: string;
}
