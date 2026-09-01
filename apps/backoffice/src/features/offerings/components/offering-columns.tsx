'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dateTimeFormatter } from '@/lib/date-format';

import {
  formatPriceBand,
  formatPublicFloat,
  offeringStatusLabel,
  offeringStatusVariant,
} from '../offering-display';
import type { OfferingListItem } from '../schemas';

export function createOfferingColumns(
  onSelect: (offering: OfferingListItem) => void,
): ColumnDef<OfferingListItem>[] {
  return [
    {
      accessorKey: 'id',
      header: 'Offering',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.slice(0, 8)}</span>,
    },
    {
      accessorKey: 'artworkId',
      header: 'Artwork',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.artworkId.slice(0, 8)}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={offeringStatusVariant[row.original.status]}>
          {offeringStatusLabel[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'band',
      header: 'Price band',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {formatPriceBand(row.original.lowPriceStroops, row.original.highPriceStroops)}
        </span>
      ),
    },
    {
      id: 'publicFloat',
      header: 'Public float',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatPublicFloat(row.original.publicFloat)}</span>
      ),
    },
    {
      id: 'approvals',
      header: 'Approvals',
      cell: ({ row }) => {
        const { count, threshold, youApproved } = row.original.approvals;
        return (
          <span className="flex items-center gap-2 text-sm">
            <span className="tabular-nums">
              {count} of {threshold}
            </span>
            {youApproved && (
              <Badge variant="outline" className="text-xs">
                ✓ You
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      accessorKey: 'windowOpenAt',
      header: 'Window opens',
      cell: ({ row }) => (
        <span className="text-sm">
          {dateTimeFormatter.format(new Date(row.original.windowOpenAt))}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onSelect(row.original)}>
          View
        </Button>
      ),
    },
  ];
}
