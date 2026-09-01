'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dateTimeFormatter } from '@/lib/date-format';

import type { Submission, SubmissionStatus } from '../schemas';
import { submissionStatusVariant, submissionStatusLabel } from '../submission-display';

function getEvidencePreview(submission: Submission): string {
  if (submission.linkUrl) return submission.linkUrl;
  if (submission.textContent) {
    return submission.textContent.length > 60
      ? submission.textContent.slice(0, 60) + '...'
      : submission.textContent;
  }
  if (submission.fileUrl) return 'File';
  return '—';
}

export function createSubmissionColumns(
  onSelect: (submission: Submission) => void,
): ColumnDef<Submission>[] {
  return [
    {
      accessorKey: 'userId',
      header: 'User',
      cell: ({ row }) => {
        const userId = row.getValue<string>('userId');
        return <span className="font-mono text-xs">{userId.slice(0, 8)}</span>;
      },
    },
    {
      accessorKey: 'missionId',
      header: 'Mission',
      cell: ({ row }) => {
        const missionId = row.getValue<string>('missionId');
        return <span className="font-mono text-xs">{missionId.slice(0, 8)}</span>;
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue<SubmissionStatus>('status');
        return <Badge variant={submissionStatusVariant[status]}>{submissionStatusLabel[status]}</Badge>;
      },
    },
    {
      id: 'evidence',
      header: 'Evidence',
      cell: ({ row }) => (
        <span className="max-w-[200px] truncate text-sm">{getEvidencePreview(row.original)}</span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Submitted',
      cell: ({ row }) => dateTimeFormatter.format(new Date(row.getValue<string>('createdAt'))),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onSelect(row.original)}>
          Review
        </Button>
      ),
    },
  ];
}
