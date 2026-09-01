'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { AdminForm } from '@/features/admins/components/admin-form';
import { useCreateAdmin } from '@/features/admins/hooks/use-admin-mutations';
import { ApiError } from '@/types/api';

export default function NewAdminPage() {
  const router = useRouter();
  const createMutation = useCreateAdmin();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Create Admin" />
      <AdminForm
        mode="create"
        error={error}
        onSubmit={(data) => {
          setError(null);
          createMutation.mutate(data, {
            onError: (err) => {
              if (err instanceof ApiError && err.status === 409) {
                setError('This email is already in use');
              } else {
                setError(err instanceof Error ? err.message : 'Failed to create admin');
              }
            },
          });
        }}
        onCancel={() => router.push('/admins')}
        isPending={createMutation.isPending}
      />
    </div>
  );
}
