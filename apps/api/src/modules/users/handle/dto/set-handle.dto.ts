import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Body for `POST /me/handle` (TOV-26). Intentionally ONLY `@IsString()` — all handle rules
 * (charset/length/leading-char/separator/reserved) run in the service so they emit the AC-mandated
 * 422 `HANDLE_FORMAT_INVALID` / `HANDLE_RESERVED`. Adding `@Matches`/`@MaxLength`/`@IsNotEmpty` here
 * would make the global ValidationPipe reject with 400 and bypass the domain error codes.
 */
export class SetHandleDto {
  @ApiProperty({ example: 'Maya', description: 'Desired handle (3–24 chars, alnum + _ - ., no leading digit)' })
  @IsString()
  handle!: string;
}
