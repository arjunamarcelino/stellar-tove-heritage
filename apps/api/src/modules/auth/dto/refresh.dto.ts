import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Refresh token (alternative to cookie)', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
