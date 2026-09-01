import { useQuery } from '@tanstack/react-query';

import { stageKeys } from '@/lib/query-keys';
import type { PaginationParams } from '@/types/api';

import { getStages, getStage } from '../api';

export function useStages(params: PaginationParams = {}) {
  return useQuery({
    queryKey: stageKeys.list(params),
    queryFn: () => getStages(params),
  });
}

export function useStage(id: string) {
  return useQuery({
    queryKey: stageKeys.detail(id),
    queryFn: () => getStage(id),
    enabled: !!id,
  });
}
