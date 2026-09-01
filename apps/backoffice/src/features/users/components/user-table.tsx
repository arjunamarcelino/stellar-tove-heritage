'use client';

import { useState } from 'react';
import type { PaginationState } from '@tanstack/react-table';

import { DataTable } from '@/components/shared/data-table';

import { useUsers } from '../hooks/use-user-queries';
import { userColumns } from './user-columns';

export function UserTable() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = useUsers({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  return (
    <DataTable
      columns={userColumns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? -1}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={isLoading}
    />
  );
}
