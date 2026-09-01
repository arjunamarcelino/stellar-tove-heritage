'use client';

import { DataTable } from '@/components/shared/data-table';

import { useDashboardMissions } from '../hooks/use-dashboard-queries';
import { dashboardMissionColumns } from './dashboard-mission-columns';

export function DashboardMissionTable() {
  const { data, isLoading, isError } = useDashboardMissions();

  if (isError) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        Failed to load mission statistics.
      </div>
    );
  }

  return (
    <DataTable
      columns={dashboardMissionColumns}
      data={data ?? []}
      isLoading={isLoading}
    />
  );
}
