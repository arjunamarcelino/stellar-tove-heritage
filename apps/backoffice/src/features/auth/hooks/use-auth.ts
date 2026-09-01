import { useQuery } from '@tanstack/react-query';

import { authKeys } from '@/lib/query-keys';

import { getMe } from '../api';

export function useAuth() {
  const { data: user, isLoading, isError } = useQuery({
    queryKey: authKeys.me,
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !isError,
  };
}
