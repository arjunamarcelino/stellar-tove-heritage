'use client';

import { useParams } from 'next/navigation';

import { MissionDetail } from '@/features/missions/components/mission-detail';

export default function MissionDetailPage() {
  const params = useParams<{ stageId: string; missionId: string }>();

  return <MissionDetail missionId={params.missionId} stageId={params.stageId} />;
}
