'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { dateTimeFormatter } from '@/lib/date-format';

import { useAdmin } from '../hooks/use-admin-queries';
import { useDeleteAdmin } from '../hooks/use-admin-mutations';
import type { Admin } from '../schemas';
import { adminRoleLabel, adminRoleVariant } from '../admin-display';

interface AdminDetailProps {
  adminId: string;
}

function AdminDetailContent({ admin }: { admin: Admin }) {
  const { user } = useAuth();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteMutation = useDeleteAdmin();
  const isSelf = user?.id === admin.id;
  const fullName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title={fullName}
        action={
          !isSelf && (
            <div className="flex gap-2">
              <Button render={<Link href={`/admins/${admin.id}/edit`} />}>Edit</Button>
              <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                Delete
              </Button>
            </div>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Admin Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Email</p>
            <p>{admin.email}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Name</p>
            <p>{fullName}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Role</p>
            <Badge variant={adminRoleVariant[admin.role]}>{adminRoleLabel[admin.role]}</Badge>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <Badge variant={admin.isActive ? 'default' : 'destructive'}>
              {admin.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Created</p>
            <p>{dateTimeFormatter.format(new Date(admin.createdAt))}</p>
          </div>
        </CardContent>
      </Card>

      <Link href="/admins" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to admins
      </Link>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Admin"
        description={`Are you sure you want to remove ${admin.email}? They will no longer be able to log in.`}
        confirmLabel="Delete"
        destructive
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(admin.id)}
      />
    </div>
  );
}

export function AdminDetail({ adminId }: AdminDetailProps) {
  const { data: admin, isLoading } = useAdmin(adminId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Admin Not Found" />
        <p className="text-muted-foreground">
          This admin could not be found.{' '}
          <Link href="/admins" className="underline">
            Back to admins
          </Link>
        </p>
      </div>
    );
  }

  return <AdminDetailContent admin={admin} />;
}
