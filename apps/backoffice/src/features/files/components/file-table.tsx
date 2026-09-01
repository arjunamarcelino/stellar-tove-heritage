'use client';

import { useState } from 'react';
import type { PaginationState } from '@tanstack/react-table';

import { DataTable } from '@/components/shared/data-table';

import { useFiles } from '../hooks/use-file-queries';
import { fileColumns } from './file-columns';

export function FileTable() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = useFiles({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  return (
    <DataTable
      columns={fileColumns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? -1}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={isLoading}
    />
  );
}
