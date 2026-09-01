import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { adminKeys } from '@/lib/query-keys';
import type { PaginationParams } from '@/types/api';

import { getAdmin, getAdmins } from '../api';

export function useAdmins(params: PaginationParams = {}) {
  return useQuery({
    queryKey: adminKeys.list(params),
    queryFn: () => getAdmins(params),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useAdmin(id: string) {
  return useQuery({
    queryKey: adminKeys.detail(id),
    queryFn: () => getAdmin(id),
    enabled: !!id,
  });
}
