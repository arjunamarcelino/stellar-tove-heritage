'use client';

import { useParams, useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminForm } from '@/features/admins/components/admin-form';
import { useAdmin } from '@/features/admins/hooks/use-admin-queries';
import { useUpdateAdmin } from '@/features/admins/hooks/use-admin-mutations';

export default function EditAdminPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: admin, isLoading } = useAdmin(params.id);
  const updateMutation = useUpdateAdmin(params.id);

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
        <p className="text-muted-foreground">This admin could not be found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Admin" />
      <AdminForm
        mode="edit"
        initialData={admin}
        onSubmit={(data) =>
          updateMutation.mutate(data, {
            onSuccess: () => router.push(`/admins/${params.id}`),
          })
        }
        onCancel={() => router.push(`/admins/${params.id}`)}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}
