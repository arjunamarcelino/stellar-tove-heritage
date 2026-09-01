import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTAiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJpYXQiOjE3MTcxNDQwMDAsImV4cCI6MTcxNzE0NDkwMH0.abc123' })
  accessToken!: string;

  @ApiPropertyOptional({ description: 'Refresh token (also set as HttpOnly cookie)', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTAiLCJ0eXBlIjoicmVmcmVzaCIsImlhdCI6MTcxNzE0NDAwMCwiZXhwIjoxNzE3NzQ4ODAwfQ.xyz789' })
  refreshToken?: string;
}
