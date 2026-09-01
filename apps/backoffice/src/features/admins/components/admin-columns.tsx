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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dateTimeFormatter } from '@/lib/date-format';

import type { Admin } from '../schemas';
import { adminRoleLabel, adminRoleVariant } from '../admin-display';

export function getAdminColumns(currentUserId?: string): ColumnDef<Admin>[] {
  return [
    {
      accessorKey: 'email',
      header: 'Email',
    },
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const { firstName, lastName } = row.original;
        return [firstName, lastName].filter(Boolean).join(' ') || '—';
      },
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => {
        const role = row.original.role;
        return <Badge variant={adminRoleVariant[role]}>{adminRoleLabel[role]}</Badge>;
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
        const admin = row.original;
        const isSelf = currentUserId === admin.id;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="size-8 p-0" />}>
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Open menu</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href={`/admins/${admin.id}`} />}>
                View details
              </DropdownMenuItem>
              {!isSelf && (
                <>
                  <DropdownMenuItem render={<Link href={`/admins/${admin.id}/edit`} />}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    render={<Link href={`/admins/${admin.id}?delete=true`} />}
                  >
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
