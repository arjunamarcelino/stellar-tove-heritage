'use client';

import { useParams } from 'next/navigation';

import { FileDetail } from '@/features/files/components/file-detail';

export default function FileDetailPage() {
  const params = useParams<{ id: string }>();

  return <FileDetail fileId={params.id} />;
}
