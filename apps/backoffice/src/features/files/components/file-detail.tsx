'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { dateTimeFormatter } from '@/lib/date-format';

import { useFile } from '../hooks/use-file-queries';
import { useDeleteFile } from '../hooks/use-file-mutations';
import type { FileRecord } from '../schemas';
import { formatFileSize, copyFileLink, openFileUrl } from '../file-display';

interface FileDetailProps {
  fileId: string;
}

function FileDetailContent({ file }: { file: FileRecord }) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteMutation = useDeleteFile();

  return (
    <div className="space-y-6">
      <PageHeader
        title={file.title}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => openFileUrl(file.urlPath, toast)}>
              View PDF
            </Button>
            <Button variant="outline" onClick={() => copyFileLink(file.urlPath, toast)}>
              Copy Link
            </Button>
            <Button render={<Link href={`/files/${file.id}/edit`} />}>Edit</Button>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              Delete
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">File Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Title</p>
            <p>{file.title}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">URL Path</p>
            <p className="font-mono text-sm">{file.urlPath}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Original Filename</p>
            <p>{file.originalFilename}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">File Size</p>
            <p>{formatFileSize(file.fileSize)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <Badge variant={file.isActive ? 'default' : 'secondary'}>
              {file.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Created</p>
            <p>{dateTimeFormatter.format(new Date(file.createdAt))}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Updated</p>
            <p>{dateTimeFormatter.format(new Date(file.updatedAt))}</p>
          </div>
        </CardContent>
      </Card>

      <Link href="/files" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to files
      </Link>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete File"
        description={`Are you sure you want to delete "${file.title}"? The public URL will stop working.`}
        confirmLabel="Delete"
        destructive
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(file.id)}
      />
    </div>
  );
}

export function FileDetail({ fileId }: FileDetailProps) {
  const { data: file, isLoading } = useFile(fileId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!file) {
    return (
      <div className="space-y-6">
        <PageHeader title="File Not Found" />
        <p className="text-muted-foreground">
          This file could not be found.{' '}
          <Link href="/files" className="underline">
            Back to files
          </Link>
        </p>
      </div>
    );
  }

  return <FileDetailContent file={file} />;
}
