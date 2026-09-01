import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { UserTable } from '@/features/users/components/user-table';

export const metadata: Metadata = {
  title: 'Users — Tove Backoffice',
};

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage platform users"
        action={
          <Button render={<Link href="/users/new" />}>Add User</Button>
        }
      />
      <UserTable />
    </div>
  );
}
