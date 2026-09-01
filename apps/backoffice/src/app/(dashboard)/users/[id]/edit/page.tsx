'use client';

import { useParams, useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { UserForm } from '@/features/users/components/user-form';
import { useUser } from '@/features/users/hooks/use-user-queries';
import { useUpdateUser } from '@/features/users/hooks/use-user-mutations';

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: user, isLoading } = useUser(params.id);
  const updateMutation = useUpdateUser(params.id);

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
        <p className="text-muted-foreground">This user could not be found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit User" />
      <UserForm
        mode="edit"
        initialData={user}
        onSubmit={(data) =>
          updateMutation.mutate(data, {
            onSuccess: () => router.push(`/users/${params.id}`),
          })
        }
        onCancel={() => router.push(`/users/${params.id}`)}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}
