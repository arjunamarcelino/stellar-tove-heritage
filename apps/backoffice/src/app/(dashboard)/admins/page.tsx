import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { AdminTable } from '@/features/admins/components/admin-table';

export const metadata: Metadata = {
  title: 'Admins — Tove Backoffice',
};

export default function AdminsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Admins"
        description="Manage backoffice administrators"
        action={
          <Button render={<Link href="/admins/new" />}>Add Admin</Button>
        }
      />
      <AdminTable />
    </div>
  );
}
