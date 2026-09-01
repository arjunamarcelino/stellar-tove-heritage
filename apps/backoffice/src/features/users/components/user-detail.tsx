'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { dateTimeFormatter } from '@/lib/date-format';

import { useUser } from '../hooks/use-user-queries';
import { useDeleteUser } from '../hooks/use-user-mutations';
import type { User } from '../schemas';

function UserDetailContent({ user }: { user: User }) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteMutation = useDeleteUser();
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title={fullName}
        action={
          <div className="flex gap-2">
            <Button render={<Link href={`/users/${user.id}/edit`} />}>Edit</Button>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              Delete
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">User Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Email</p>
            <p>{user.email}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Name</p>
            <p>{fullName}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <Badge variant={user.isActive ? 'default' : 'destructive'}>
              {user.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Joined</p>
            <p>{dateTimeFormatter.format(new Date(user.createdAt))}</p>
          </div>
        </CardContent>
      </Card>

      <Link href="/users" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to users
      </Link>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Deactivate User"
        description={`Are you sure you want to deactivate ${user.email}? They will no longer be able to access the platform.`}
        confirmLabel="Deactivate"
        destructive
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(user.id)}
      />
    </div>
  );
}

interface UserDetailProps {
  userId: string;
}

export function UserDetail({ userId }: UserDetailProps) {
  const { data: user, isLoading } = useUser(userId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader title="User Not Found" />
        <p className="text-muted-foreground">
          This user could not be found.{' '}
          <Link href="/users" className="underline">
            Back to users
          </Link>
        </p>
      </div>
    );
  }

  return <UserDetailContent user={user} />;
}
