'use client';

import { useParams, useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StageForm } from '@/features/stages/components/stage-form';
import { useStage } from '@/features/stages/hooks/use-stage-queries';
import { useUpdateStage } from '@/features/stages/hooks/use-stage-mutations';

export default function EditStagePage() {
  const params = useParams<{ stageId: string }>();
  const router = useRouter();
  const { data: stage, isLoading } = useStage(params.stageId);
  const updateMutation = useUpdateStage(params.stageId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!stage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Stage Not Found" />
        <p className="text-muted-foreground">This stage could not be found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Stage" />
      <StageForm
        initialData={stage}
        onSubmit={(data) =>
          updateMutation.mutate(data, {
            onSuccess: () => router.push(`/missions/stages/${params.stageId}`),
          })
        }
        onCancel={() => router.push(`/missions/stages/${params.stageId}`)}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}
