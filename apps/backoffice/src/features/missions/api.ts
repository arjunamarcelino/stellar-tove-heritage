import { api } from '@/lib/api-client';
import { buildQueryString } from '@/lib/url-params';
import type { PaginatedResponse } from '@/types/api';
import type { MissionListParams } from '@/types/api';

import type { Mission, MissionFormData } from './schemas';

export function getMissions(params?: MissionListParams): Promise<PaginatedResponse<Mission>> {
  const { stageId, ...paginationParams } = params ?? {};
  const filters: Record<string, string | undefined> = { stageId };
  return api.get<PaginatedResponse<Mission>>(
    `/api/missions${buildQueryString(paginationParams, filters)}`,
  );
}

export function getMission(id: string): Promise<Mission> {
  return api.get<Mission>(`/api/missions/${id}`);
}

export function createMission(data: MissionFormData): Promise<Mission> {
  return api.post<Mission>('/api/missions', data);
}

export function updateMission(id: string, data: Partial<MissionFormData>): Promise<Mission> {
  return api.patch<Mission>(`/api/missions/${id}`, data);
}

export function deleteMission(id: string): Promise<void> {
  return api.delete(`/api/missions/${id}`);
}
