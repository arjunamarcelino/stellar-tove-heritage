import { api } from '@/lib/api-client';
import { uploadRequest } from '@/lib/upload-client';
import { buildQueryString } from '@/lib/url-params';
import type { PaginatedResponse, PaginationParams } from '@/types/api';

import type { FileRecord } from './schemas';

export function getFiles(params?: PaginationParams): Promise<PaginatedResponse<FileRecord>> {
  return api.get<PaginatedResponse<FileRecord>>(`/api/files${buildQueryString(params)}`);
}

export function getFile(id: string): Promise<FileRecord> {
  return api.get<FileRecord>(`/api/files/${id}`);
}

export function createFile(
  formData: FormData,
  onProgress?: (percent: number) => void,
): { promise: Promise<FileRecord>; abort: () => void } {
  return uploadRequest<FileRecord>('POST', '/api/files', formData, onProgress);
}

export function updateFile(
  id: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): { promise: Promise<FileRecord>; abort: () => void } {
  return uploadRequest<FileRecord>('PATCH', `/api/files/${id}`, formData, onProgress);
}

export function deleteFile(id: string): Promise<void> {
  return api.delete(`/api/files/${id}`);
}
