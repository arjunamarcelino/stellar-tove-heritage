import type { Metadata } from 'next';

import { PageHeader } from '@/components/shared/page-header';
import { OfferingTable } from '@/features/offerings/components/offering-table';

export const metadata: Metadata = {
  title: 'Offerings — Tove Backoffice',
};

export default function OfferingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Offerings"
        description="Review and approve planned primary offerings (2-of-3 multisig)"
      />
      <OfferingTable />
    </div>
  );
}
