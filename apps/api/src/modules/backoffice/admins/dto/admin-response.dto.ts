import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminRole } from '@common/enums/admin-role.enum';

export class AdminResponseDto {
  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  id!: string;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;

  @ApiProperty({ enum: AdminRole, example: AdminRole.ADMIN })
  role!: AdminRole;

  @ApiPropertyOptional({ example: 'Jane' })
  firstName!: string | null;

  @ApiPropertyOptional({ example: 'Admin' })
  lastName!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-05-31T10:00:00.000Z' })
  createdAt!: Date;

  static fromEntity(admin: {
    id: string;
    email: string;
    role: AdminRole;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    createdAt: Date;
  }): AdminResponseDto {
    const dto = new AdminResponseDto();
    dto.id = admin.id;
    dto.email = admin.email;
    dto.role = admin.role;
    dto.firstName = admin.firstName;
    dto.lastName = admin.lastName;
    dto.isActive = admin.isActive;
    dto.createdAt = admin.createdAt;
    return dto;
  }
}
