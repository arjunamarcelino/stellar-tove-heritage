'use client';

import { useState } from 'react';
import type { PaginationState } from '@tanstack/react-table';

import { DataTable } from '@/components/shared/data-table';

import { useStages } from '../hooks/use-stage-queries';
import { stageColumns } from './stage-columns';

export function StageTable() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = useStages({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  return (
    <DataTable
      columns={stageColumns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? -1}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={isLoading}
    />
  );
}
