import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiPropertyOptional({ example: 'user@example.com', nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ example: 'John' })
  firstName!: string | null;

  @ApiPropertyOptional({ example: 'Doe' })
  lastName!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-05-31T10:00:00.000Z' })
  createdAt!: Date;

  static fromEntity(user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    createdAt: Date;
  }): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.isActive = user.isActive;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
