'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { FileForm } from '@/features/files/components/file-form';
import { useCreateFile } from '@/features/files/hooks/use-file-mutations';
import { ApiError } from '@/types/api';

export default function NewFilePage() {
  const router = useRouter();
  const createMutation = useCreateFile();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Upload File" />
      <FileForm
        mode="create"
        error={error}
        onSubmit={(formData) => {
          setError(null);
          createMutation.mutate(formData, {
            onError: (err) => {
              if (err instanceof ApiError && err.status === 409) {
                setError('This URL path is already in use');
              } else if (err instanceof ApiError && err.status === 413) {
                setError('File exceeds the 25 MB limit');
              } else {
                setError(err instanceof Error ? err.message : 'Failed to upload file');
              }
            },
          });
        }}
        onCancel={() => router.push('/files')}
        isPending={createMutation.isPending}
        progress={createMutation.progress}
      />
    </div>
  );
}
