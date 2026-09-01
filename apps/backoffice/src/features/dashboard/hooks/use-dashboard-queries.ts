import { useQuery } from '@tanstack/react-query';

import { dashboardKeys } from '@/lib/query-keys';

import { getDashboardMissions, getDashboardSummary } from '../api';

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: getDashboardSummary,
    staleTime: 60_000,
  });
}

export function useDashboardMissions() {
  return useQuery({
    queryKey: dashboardKeys.missions(),
    queryFn: getDashboardMissions,
    staleTime: 30_000,
  });
}
