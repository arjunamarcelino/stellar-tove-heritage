import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminTokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMmMzZDRlNS1mNmE3LTg5MDEtYmNkZS1mMTIzNDU2Nzg5MDEiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwiaWF0IjoxNzE3MTQ0MDAwLCJleHAiOjE3MTcxNDQ5MDB9.abc123' })
  accessToken!: string;

  @ApiPropertyOptional({ description: 'Refresh token (also set as HttpOnly cookie)', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMmMzZDRlNS1mNmE3LTg5MDEtYmNkZS1mMTIzNDU2Nzg5MDEiLCJ0eXBlIjoicmVmcmVzaCIsImlhdCI6MTcxNzE0NDAwMCwiZXhwIjoxNzE3NzQ4ODAwfQ.xyz789' })
  refreshToken?: string;
}
