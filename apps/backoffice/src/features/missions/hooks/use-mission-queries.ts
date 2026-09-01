import { useQuery } from '@tanstack/react-query';

import { missionKeys } from '@/lib/query-keys';
import type { MissionListParams } from '@/types/api';

import { getMissions, getMission } from '../api';

export function useMissions(params: MissionListParams = {}) {
  return useQuery({
    queryKey: missionKeys.list(params),
    queryFn: () => getMissions(params),
  });
}

export function useMission(id: string) {
  return useQuery({
    queryKey: missionKeys.detail(id),
    queryFn: () => getMission(id),
    enabled: !!id,
  });
}
