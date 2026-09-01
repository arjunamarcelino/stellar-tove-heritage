'use client';

import { useMemo, useState } from 'react';
import type { PaginationState } from '@tanstack/react-table';

import { DataTable } from '@/components/shared/data-table';
import { useAuth } from '@/features/auth/hooks/use-auth';

import { useAdmins } from '../hooks/use-admin-queries';
import { getAdminColumns } from './admin-columns';

export function AdminTable() {
  const { user } = useAuth();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = useAdmins({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  const columns = useMemo(() => getAdminColumns(user?.id), [user?.id]);

  return (
    <DataTable
      columns={columns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? -1}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={isLoading}
    />
  );
}
