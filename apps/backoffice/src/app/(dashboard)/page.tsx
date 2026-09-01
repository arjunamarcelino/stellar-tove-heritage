import type { Metadata } from 'next';

import { PageHeader } from '@/components/shared/page-header';
import { DashboardMissionTable } from '@/features/dashboard/components/dashboard-mission-table';
import { Overview } from '@/features/dashboard/components/overview';

export const metadata: Metadata = {
  title: 'Dashboard — Tove Backoffice',
};

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Overview of the Tove platform" />
      <Overview />
      <DashboardMissionTable />
    </div>
  );
}
