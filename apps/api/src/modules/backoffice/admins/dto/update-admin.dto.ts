import { PartialType, OmitType } from '@nestjs/swagger';
import { AdminRegisterDto } from './admin-register.dto';

export class UpdateAdminDto extends PartialType(
  OmitType(AdminRegisterDto, ['password', 'email'] as const),
) {}
