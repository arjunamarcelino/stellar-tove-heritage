import { api } from '@/lib/api-client';
import { buildQueryString } from '@/lib/url-params';
import type { PaginatedResponse, PaginationParams } from '@/types/api';

import type { Admin, RegisterAdminData, UpdateAdminData } from './schemas';

export function getAdmins(params?: PaginationParams): Promise<PaginatedResponse<Admin>> {
  return api.get<PaginatedResponse<Admin>>(`/api/admins${buildQueryString(params)}`);
}

export function getAdmin(id: string): Promise<Admin> {
  return api.get<Admin>(`/api/admins/${id}`);
}

export function createAdmin(data: RegisterAdminData): Promise<Admin> {
  return api.post<Admin>('/api/admins', data);
}

export function updateAdmin(id: string, data: UpdateAdminData): Promise<Admin> {
  return api.patch<Admin>(`/api/admins/${id}`, data);
}

export function deleteAdmin(id: string): Promise<void> {
  return api.delete(`/api/admins/${id}`);
}
