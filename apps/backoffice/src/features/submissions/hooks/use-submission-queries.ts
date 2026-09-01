import { useQuery } from '@tanstack/react-query';

import { submissionKeys } from '@/lib/query-keys';

import { getSubmissions, getSubmission } from '../api';

export function useSubmissions() {
  return useQuery({
    queryKey: submissionKeys.list({}),
    queryFn: () => getSubmissions(),
    staleTime: 15_000,
  });
}

export function useSubmission(id: string) {
  return useQuery({
    queryKey: submissionKeys.detail(id),
    queryFn: () => getSubmission(id),
    enabled: !!id,
  });
}
