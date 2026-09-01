'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { MissionTable } from '@/features/missions/components/mission-table';
import { dateTimeFormatter } from '@/lib/date-format';

import { useStage } from '../hooks/use-stage-queries';
import { useDeleteStage } from '../hooks/use-stage-mutations';
import type { Stage } from '../schemas';
import { getStageStatus, stageStatusVariant, stageStatusLabel } from '../stage-display';

interface StageDetailProps {
  stageId: string;
}

function StageDetailContent({ stage }: { stage: Stage }) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteMutation = useDeleteStage();
  const status = getStageStatus(stage);

  return (
    <div className="space-y-6">
      <PageHeader
        title={stage.title}
        action={
          <div className="flex gap-2">
            <Button render={<Link href={`/missions/stages/${stage.id}/edit`} />}>Edit</Button>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              Delete
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <Badge variant={stageStatusVariant[status]}>{stageStatusLabel[status]}</Badge>
          </div>
          {stage.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p>{stage.description}</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Order</p>
              <p>{stage.order}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Starts At</p>
              <p>{stage.startsAt ? dateTimeFormatter.format(new Date(stage.startsAt)) : '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Created</p>
              <p>{dateTimeFormatter.format(new Date(stage.createdAt))}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Missions</h2>
          <Button
            size="sm"
            render={<Link href={`/missions/stages/${stage.id}/missions/new`} />}
          >
            Add Mission
          </Button>
        </div>
        <MissionTable stageId={stage.id} />
      </div>

      <Link href="/missions" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to stages
      </Link>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Stage"
        description="This will permanently delete this stage and all its missions. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(stage.id)}
      />
    </div>
  );
}

export function StageDetail({ stageId }: StageDetailProps) {
  const { data: stage, isLoading } = useStage(stageId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!stage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Stage Not Found" />
        <p className="text-muted-foreground">
          This stage could not be found.{' '}
          <Link href="/missions" className="underline">
            Back to stages
          </Link>
        </p>
      </div>
    );
  }

  return <StageDetailContent stage={stage} />;
}
