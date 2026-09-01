import type { AdminRole } from '@/features/auth/schemas';

export const adminRoleVariant: Record<AdminRole, 'default' | 'secondary'> = {
  superadmin: 'default',
  admin: 'secondary',
};

export const adminRoleLabel: Record<AdminRole, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
};
