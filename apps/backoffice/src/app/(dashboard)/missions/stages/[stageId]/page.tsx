'use client';

import { useParams } from 'next/navigation';

import { StageDetail } from '@/features/stages/components/stage-detail';

export default function StageDetailPage() {
  const params = useParams<{ stageId: string }>();

  return <StageDetail stageId={params.stageId} />;
}
