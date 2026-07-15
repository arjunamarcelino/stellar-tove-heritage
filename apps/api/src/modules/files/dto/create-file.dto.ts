import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';

export const URL_PATH_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateFileDto {
  @ApiProperty({ example: 'Annual Report 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiProperty({ example: 'annual-report-2026' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  @Matches(URL_PATH_REGEX, {
    message: 'urlPath must be a valid slug (lowercase alphanumeric and hyphens)',
  })
  urlPath!: string;
}
