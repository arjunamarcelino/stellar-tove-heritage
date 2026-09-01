import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { FileTable } from '@/features/files/components/file-table';

export const metadata: Metadata = {
  title: 'Files — Tove Backoffice',
};

export default function FilesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Files"
        description="Manage public PDF documents"
        action={
          <Button render={<Link href="/files/new" />}>Upload File</Button>
        }
      />
      <FileTable />
    </div>
  );
}
