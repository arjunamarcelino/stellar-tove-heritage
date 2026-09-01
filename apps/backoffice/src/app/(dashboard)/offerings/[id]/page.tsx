'use client';

import { useParams } from 'next/navigation';

import { OfferingDetail } from '@/features/offerings/components/offering-detail';

export default function OfferingDetailPage() {
  const params = useParams<{ id: string }>();
  // key on id so navigating detail→detail remounts (resets the poll-arm + lifecycle baseline refs,
  // which are component-instance-scoped) rather than reusing the same fiber with stale state.
  return <OfferingDetail key={params.id} id={params.id} />;
}
