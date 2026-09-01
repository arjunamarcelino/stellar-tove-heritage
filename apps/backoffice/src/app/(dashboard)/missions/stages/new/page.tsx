'use client';

import { useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { StageForm } from '@/features/stages/components/stage-form';
import { useCreateStage } from '@/features/stages/hooks/use-stage-mutations';

export default function NewStagePage() {
  const router = useRouter();
  const { mutate, isPending } = useCreateStage();

  return (
    <div className="space-y-6">
      <PageHeader title="Create Stage" />
      <StageForm
        onSubmit={(data) => mutate(data)}
        onCancel={() => router.push('/missions')}
        isPending={isPending}
      />
    </div>
  );
}
