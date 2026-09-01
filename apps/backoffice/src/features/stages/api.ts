import { api } from '@/lib/api-client';
import { buildQueryString } from '@/lib/url-params';
import type { PaginatedResponse, PaginationParams } from '@/types/api';

import type { Stage, StageFormData } from './schemas';

export function getStages(params?: PaginationParams): Promise<PaginatedResponse<Stage>> {
  return api.get<PaginatedResponse<Stage>>(`/api/stages${buildQueryString(params)}`);
}

export function getStage(id: string): Promise<Stage> {
  return api.get<Stage>(`/api/stages/${id}`);
}

export function createStage(data: StageFormData): Promise<Stage> {
  return api.post<Stage>('/api/stages', data);
}

export function updateStage(id: string, data: Partial<StageFormData>): Promise<Stage> {
  return api.patch<Stage>(`/api/stages/${id}`, data);
}

export function deleteStage(id: string): Promise<void> {
  return api.delete(`/api/stages/${id}`);
}
