'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Copy, ExternalLink, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dateTimeFormatter } from '@/lib/date-format';

import type { FileRecord } from '../schemas';
import { formatFileSize, copyFileLink, openFileUrl } from '../file-display';

export const fileColumns: ColumnDef<FileRecord>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
  },
  {
    accessorKey: 'urlPath',
    header: 'URL Path',
    cell: ({ row }) => {
      const urlPath = row.original.urlPath;
      return <span className="font-mono text-xs">{urlPath}</span>;
    },
  },
  {
    accessorKey: 'fileSize',
    header: 'Size',
    cell: ({ row }) => formatFileSize(row.original.fileSize),
  },
  {
    accessorKey: 'isActive',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
        {row.original.isActive ? 'Active' : 'Inactive'}
      </Badge>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => dateTimeFormatter.format(new Date(row.getValue<string>('createdAt'))),
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const file = row.original;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="size-8 p-0" />}>
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Open menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openFileUrl(file.urlPath, toast)}>
              <ExternalLink className="mr-2 size-4" />
              View PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyFileLink(file.urlPath, toast)}>
              <Copy className="mr-2 size-4" />
              Copy Link
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/files/${file.id}`} />}>
              View details
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/files/${file.id}/edit`} />}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              render={<Link href={`/files/${file.id}?delete=true`} />}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
