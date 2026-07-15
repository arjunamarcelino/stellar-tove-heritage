import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SubmitEvidenceDto {
  @ApiPropertyOptional({ example: 'https://x.com/tove_art' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: true })
  @MaxLength(2048)
  linkUrl?: string;

  @ApiPropertyOptional({ example: 'I joined the Discord server and my username is ToveUser#1234' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  textContent?: string;
}
