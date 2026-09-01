import { api } from '@/lib/api-client';

import type { AuthUser, LoginCredentials, LoginResponse } from './schemas';

export function login(credentials: LoginCredentials): Promise<LoginResponse> {
  return api.post<LoginResponse>('/api/auth/login', credentials);
}

export function logout(): Promise<void> {
  return api.post('/api/auth/logout');
}

export function getMe(): Promise<AuthUser> {
  return api.get<AuthUser>('/api/auth/me');
}
