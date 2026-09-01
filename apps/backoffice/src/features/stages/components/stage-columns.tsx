'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dateTimeFormatter } from '@/lib/date-format';

import type { Stage } from '../schemas';
import { getStageStatus, stageStatusVariant, stageStatusLabel } from '../stage-display';

export const stageColumns: ColumnDef<Stage>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
  },
  {
    accessorKey: 'order',
    header: 'Order',
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = getStageStatus(row.original);
      return <Badge variant={stageStatusVariant[status]}>{stageStatusLabel[status]}</Badge>;
    },
  },
  {
    accessorKey: 'startsAt',
    header: 'Starts At',
    cell: ({ row }) => {
      const startsAt = row.getValue<string | null>('startsAt');
      return startsAt ? dateTimeFormatter.format(new Date(startsAt)) : '—';
    },
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => dateTimeFormatter.format(new Date(row.getValue<string>('createdAt'))),
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const stage = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="size-8 p-0" />}>
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Open menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={`/missions/stages/${stage.id}`} />}>
              View
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/missions/stages/${stage.id}/edit`} />}>
              Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
