'use client';

import { useState } from 'react';
import type { PaginationState } from '@tanstack/react-table';

import { DataTable } from '@/components/shared/data-table';

import { useMissions } from '../hooks/use-mission-queries';
import { missionColumns } from './mission-columns';

interface MissionTableProps {
  stageId: string;
}

export function MissionTable({ stageId }: MissionTableProps) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = useMissions({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    stageId,
  });

  return (
    <DataTable
      columns={missionColumns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? -1}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={isLoading}
    />
  );
}
