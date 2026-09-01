import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { fileKeys } from '@/lib/query-keys';
import type { PaginationParams } from '@/types/api';

import { getFile, getFiles } from '../api';

export function useFiles(params: PaginationParams = {}) {
  return useQuery({
    queryKey: fileKeys.list(params),
    queryFn: () => getFiles(params),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useFile(id: string) {
  return useQuery({
    queryKey: fileKeys.detail(id),
    queryFn: () => getFile(id),
    enabled: !!id,
    staleTime: 2 * 60_000,
  });
}
