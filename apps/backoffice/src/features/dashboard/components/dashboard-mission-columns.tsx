'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

import { formatNumber } from '../format';
import type { DashboardMissionStats } from '../schemas';

function numericColumn(
  accessorKey: keyof DashboardMissionStats,
  header: string,
): ColumnDef<DashboardMissionStats> {
  return {
    accessorKey,
    header: () => <div className="text-right">{header}</div>,
    cell: ({ row }) => (
      <div className="text-right">{formatNumber(row.getValue<number>(accessorKey))}</div>
    ),
  };
}

export const dashboardMissionColumns: ColumnDef<DashboardMissionStats>[] = [
  {
    accessorKey: 'missionTitle',
    header: 'Mission',
    cell: ({ row }) => (
      <Link href="/missions" className="font-medium hover:underline">
        {row.getValue<string>('missionTitle')}
      </Link>
    ),
  },
  {
    accessorKey: 'stageTitle',
    header: 'Stage',
  },
  numericColumn('totalUsers', 'Users'),
  numericColumn('pending', 'Pending'),
  numericColumn('accepted', 'Accepted'),
  numericColumn('rejected', 'Rejected'),
];
