import { api } from '@/lib/api-client';
import { buildQueryString } from '@/lib/url-params';
import type { PaginatedResponse, PaginationParams } from '@/types/api';

import type { CreateUserData, UpdateUserData, User } from './schemas';

export function getUsers(params?: PaginationParams): Promise<PaginatedResponse<User>> {
  return api.get<PaginatedResponse<User>>(`/api/users${buildQueryString(params)}`);
}

export function getUser(id: string): Promise<User> {
  return api.get<User>(`/api/users/${id}`);
}

export function createUser(data: CreateUserData): Promise<User> {
  return api.post<User>('/api/users', data);
}

export function updateUser(id: string, data: UpdateUserData): Promise<User> {
  return api.patch<User>(`/api/users/${id}`, data);
}

export function deleteUser(id: string): Promise<void> {
  return api.delete(`/api/users/${id}`);
}
