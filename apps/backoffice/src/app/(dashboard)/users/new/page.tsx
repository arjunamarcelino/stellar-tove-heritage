'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { UserForm } from '@/features/users/components/user-form';
import { useCreateUser } from '@/features/users/hooks/use-user-mutations';
import { ApiError } from '@/types/api';

export default function NewUserPage() {
  const router = useRouter();
  const createMutation = useCreateUser();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Create User" />
      <UserForm
        mode="create"
        error={error}
        onSubmit={(data) => {
          setError(null);
          createMutation.mutate(data, {
            onError: (err) => {
              if (err instanceof ApiError && err.status === 409) {
                setError('This email is already registered');
              } else {
                setError(err instanceof Error ? err.message : 'Failed to create user');
              }
            },
          });
        }}
        onCancel={() => router.push('/users')}
        isPending={createMutation.isPending}
      />
    </div>
  );
}
