import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '@common/enums/admin-role.enum';

export const ADMIN_ROLES_KEY = 'adminRoles';
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
