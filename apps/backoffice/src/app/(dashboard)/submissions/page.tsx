import type { Metadata } from 'next';

import { PageHeader } from '@/components/shared/page-header';
import { SubmissionTable } from '@/features/submissions/components/submission-table';

export const metadata: Metadata = {
  title: 'Submissions — Tove Backoffice',
};

export default function SubmissionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Submissions" description="Review user-submitted evidence" />
      <SubmissionTable />
    </div>
  );
}
