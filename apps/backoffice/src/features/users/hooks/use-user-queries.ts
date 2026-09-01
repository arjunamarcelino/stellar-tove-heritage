import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { userKeys } from '@/lib/query-keys';
import type { PaginationParams } from '@/types/api';

import { getUser, getUsers } from '../api';

export function useUsers(params: PaginationParams = {}) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => getUsers(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => getUser(id),
    enabled: !!id,
  });
}
