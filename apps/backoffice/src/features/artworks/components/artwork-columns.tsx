'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { artworkStatusVariant, artworkStatusLabel, artistLabel } from '../artwork-display';
import type { ArtworkListItem } from '../schemas';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export const artworkColumns: ColumnDef<ArtworkListItem>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    id: 'artist',
    header: 'Artist',
    cell: ({ row }) => <span className="text-sm">{artistLabel(row.original)}</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.original.status;
      return <Badge variant={artworkStatusVariant[status]}>{artworkStatusLabel[status]}</Badge>;
    },
  },
  {
    id: 'fraction',
    header: 'Fraction token',
    cell: ({ row }) => {
      const fc = row.original.fractionContract;
      if (!fc) return <span className="text-sm text-muted-foreground">—</span>;
      return (
        <span className="font-mono text-xs">
          {fc.tokenAddress ? shortAddress(fc.tokenAddress) : fc.status}
        </span>
      );
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" render={<Link href={`/artworks/${row.original.id}`} />}>
        View
      </Button>
    ),
  },
];
