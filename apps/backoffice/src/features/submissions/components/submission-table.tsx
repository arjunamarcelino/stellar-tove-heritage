'use client';

import { useMemo, useState } from 'react';

import { DataTable } from '@/components/shared/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useSubmissions } from '../hooks/use-submission-queries';
import { createSubmissionColumns } from './submission-columns';
import { SubmissionReviewSheet } from './submission-review-sheet';
import type { Submission, SubmissionStatus } from '../schemas';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
];

export function SubmissionTable() {
  const [statusFilter, setStatusFilter] = useState<SubmissionStatus | undefined>('pending');
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false);

  const columns = useMemo(
    () =>
      createSubmissionColumns((submission) => {
        setSelectedSubmission(submission);
        setReviewSheetOpen(true);
      }),
    [],
  );

  const { data, isLoading, isFetching } = useSubmissions();

  const filteredData = useMemo(() => {
    const rows = data?.data ?? [];
    return statusFilter ? rows.filter((row) => row.status === statusFilter) : rows;
  }, [data, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select
            value={statusFilter ?? 'all'}
            onValueChange={(value) => {
              setStatusFilter(value === 'all' ? undefined : (value as SubmissionStatus));
            }}
          >
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground">Refreshing...</span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        isLoading={isLoading}
      />

      <SubmissionReviewSheet
        submission={selectedSubmission}
        open={reviewSheetOpen}
        onOpenChange={setReviewSheetOpen}
      />
    </div>
  );
}
