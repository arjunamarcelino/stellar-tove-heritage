'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { FileForm } from '@/features/files/components/file-form';
import { useFile } from '@/features/files/hooks/use-file-queries';
import { useUpdateFile } from '@/features/files/hooks/use-file-mutations';
import { ApiError } from '@/types/api';

export default function EditFilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: file, isLoading } = useFile(params.id);
  const updateMutation = useUpdateFile(params.id);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!file) {
    return (
      <div className="space-y-6">
        <PageHeader title="File Not Found" />
        <p className="text-muted-foreground">This file could not be found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit File" />
      <FileForm
        mode="edit"
        initialData={file}
        error={error}
        onSubmit={(formData) => {
          setError(null);
          updateMutation.mutate(formData, {
            onSuccess: () => router.push(`/files/${params.id}`),
            onError: (err) => {
              if (err instanceof ApiError && err.status === 409) {
                setError('This URL path is already in use');
              } else {
                setError(err instanceof Error ? err.message : 'Failed to update file');
              }
            },
          });
        }}
        onCancel={() => router.push(`/files/${params.id}`)}
        isPending={updateMutation.isPending}
        progress={updateMutation.progress}
      />
    </div>
  );
}
