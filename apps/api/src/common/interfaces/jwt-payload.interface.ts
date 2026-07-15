import { AdminRole } from '@common/enums/admin-role.enum';

interface BaseJwtPayload {
  sub: string;
  jti: string;
  iss: string;
  aud: string;
}

export interface UserJwtPayload extends BaseJwtPayload {
  type: 'user';
  // Null for BYOW wallet-only users. NEVER used for identity lookup (use `sub`).
  email: string | null;
}

export interface AdminJwtPayload extends BaseJwtPayload {
  type: 'admin';
  email: string;
  role: AdminRole;
}

export type JwtPayload = UserJwtPayload | AdminJwtPayload;
