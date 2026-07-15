import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class VerificationConfigDto {
  @ApiProperty({ example: 'tove_art' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._]+$/, {
    message: 'targetUsername must contain only alphanumeric characters, dots, and underscores',
  })
  targetUsername!: string;
}
