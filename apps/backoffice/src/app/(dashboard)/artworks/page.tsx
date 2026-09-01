import type { Metadata } from 'next';

import { PageHeader } from '@/components/shared/page-header';
import { ArtworkTable } from '@/features/artworks/components/artwork-table';

export const metadata: Metadata = {
  title: 'Artworks — Tove Backoffice',
};

export default function ArtworksPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Artworks" description="Verified artworks and fractionalization status" />
      <ArtworkTable />
    </div>
  );
}
