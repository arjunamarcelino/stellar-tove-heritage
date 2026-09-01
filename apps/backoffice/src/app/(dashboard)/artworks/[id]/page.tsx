'use client';

import { useParams } from 'next/navigation';

import { ArtworkDetail } from '@/features/artworks/components/artwork-detail';

export default function ArtworkDetailPage() {
  const params = useParams<{ id: string }>();

  return <ArtworkDetail artworkId={params.id} />;
}
