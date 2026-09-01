'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PaginationState } from '@tanstack/react-table';

import { DataTable } from '@/components/shared/data-table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useOfferings } from '../hooks/use-offering-queries';
import { createOfferingColumns } from './offering-columns';

// Default filter = the non-terminal active set (mirrors the backend default).
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'planned', label: 'Planned' },
  { value: 'approved', label: 'Approved' },
  { value: 'opened', label: 'Opened' },
  { value: 'subscribed', label: 'Subscribed' },
] as const;

function statusParam(value: string): string | undefined {
  return value === 'active' ? undefined : value;
}

export function OfferingTable() {
  const router = useRouter();
  const [status, setStatus] = useState<string>('planned');
  const [needsMySignature, setNeedsMySignature] = useState(false);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const columns = useMemo(
    () => createOfferingColumns((offering) => router.push(`/offerings/${offering.id}`)),
    [router],
  );

  const { data, isLoading, isError, refetch, isFetching } = useOfferings({
    status: statusParam(status),
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  // "Needs my signature" filters the CURRENT page client-side (youApproved isn't a server filter).
  // Counts/pagination remain per-page — a documented MVP limitation (plan I2).
  const rows = useMemo(() => {
    const all = data?.data ?? [];
    return needsMySignature ? all.filter((o) => !o.approvals.youApproved) : all;
  }, [data, needsMySignature]);

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <p className="mb-3 text-destructive">Could not load offerings.</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select value={status} onValueChange={(v) => setStatus(v ?? 'active')}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant={needsMySignature ? 'default' : 'outline'}
          size="sm"
          aria-pressed={needsMySignature}
          onClick={() => setNeedsMySignature((v) => !v)}
        >
          Needs my signature
        </Button>
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground">Refreshing…</span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        pageCount={data?.meta.totalPages ?? -1}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={isLoading}
      />
    </div>
  );
}
