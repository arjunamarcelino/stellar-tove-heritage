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

import type { Mission, EvidenceType, VerificationMethod } from '../schemas';
import { evidenceVariant, verificationLabel } from '../mission-display';

export const missionColumns: ColumnDef<Mission>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
  },
  {
    accessorKey: 'order',
    header: 'Order',
  },
  {
    accessorKey: 'evidenceType',
    header: 'Evidence',
    cell: ({ row }) => {
      const type = row.getValue<EvidenceType>('evidenceType');
      return <Badge variant={evidenceVariant[type]}>{type}</Badge>;
    },
  },
  {
    accessorKey: 'verificationMethod',
    header: 'Verification',
    cell: ({ row }) => {
      const method = row.getValue<VerificationMethod>('verificationMethod');
      return <span className="text-sm">{verificationLabel[method]}</span>;
    },
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const isActive = row.original.isActive;
      return (
        <Badge variant={isActive ? 'default' : 'outline'}>{isActive ? 'Active' : 'Inactive'}</Badge>
      );
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
      const mission = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="size-8 p-0" />}>
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Open menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              render={
                <Link
                  href={`/missions/stages/${mission.stageId}/missions/${mission.id}`}
                />
              }
            >
              View / Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
