import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StageTable } from '@/features/stages/components/stage-table';

export const metadata: Metadata = {
  title: 'Stages — Tove Backoffice',
};

export default function StagesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stages"
        description="Manage mission stages"
        action={
          <Button render={<Link href="/missions/stages/new" />}>New Stage</Button>
        }
      />
      <StageTable />
    </div>
  );
}
