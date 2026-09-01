'use client';

import { useParams, useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { MissionForm } from '@/features/missions/components/mission-form';
import { useCreateMission } from '@/features/missions/hooks/use-mission-mutations';

export default function NewMissionPage() {
  const params = useParams<{ stageId: string }>();
  const router = useRouter();
  const { mutate, isPending } = useCreateMission(params.stageId);

  return (
    <div className="space-y-6">
      <PageHeader title="Create Mission" />
      <MissionForm
        stageId={params.stageId}
        onSubmit={(data) => mutate(data)}
        onCancel={() => router.push(`/missions/stages/${params.stageId}`)}
        isPending={isPending}
      />
    </div>
  );
}
