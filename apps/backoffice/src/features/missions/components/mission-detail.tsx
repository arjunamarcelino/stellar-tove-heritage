'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { dateTimeFormatter } from '@/lib/date-format';

import { useMission } from '../hooks/use-mission-queries';
import { useUpdateMission, useDeleteMission } from '../hooks/use-mission-mutations';
import { evidenceVariant, verificationLabel } from '../mission-display';
import { MissionForm } from './mission-form';
import type { Mission } from '../schemas';

interface MissionDetailProps {
  missionId: string;
  stageId: string;
}

function MissionDetailContent({ mission, stageId }: { mission: Mission; stageId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const updateMutation = useUpdateMission(mission.id, stageId);
  const deleteMutation = useDeleteMission(stageId);

  if (isEditing) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit Mission" />
        <MissionForm
          stageId={stageId}
          initialData={mission}
          onSubmit={(data) => {
            updateMutation.mutate(data, {
              onSuccess: () => setIsEditing(false),
            });
          }}
          onCancel={() => setIsEditing(false)}
          isPending={updateMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={mission.title}
        action={
          <div className="flex gap-2">
            <Button onClick={() => setIsEditing(true)}>Edit</Button>
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
          {mission.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p>{mission.description}</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Order</p>
              <p>{mission.order}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Evidence Type</p>
              <Badge variant={evidenceVariant[mission.evidenceType]}>{mission.evidenceType}</Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Status</p>
              <Badge variant={mission.isActive ? 'default' : 'outline'}>
                {mission.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Verification</p>
              <p>{verificationLabel[mission.verificationMethod]}</p>
            </div>
            {mission.verificationConfig && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Target Username</p>
                <p>{mission.verificationConfig.targetUsername}</p>
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Created</p>
            <p>{dateTimeFormatter.format(new Date(mission.createdAt))}</p>
          </div>
        </CardContent>
      </Card>

      <Link
        href={`/missions/stages/${stageId}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to stage
      </Link>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Mission"
        description="Are you sure you want to delete this mission? This action cannot be undone."
        confirmLabel="Delete"
        destructive
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(mission.id)}
      />
    </div>
  );
}

export function MissionDetail({ missionId, stageId }: MissionDetailProps) {
  const { data: mission, isLoading } = useMission(missionId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="space-y-6">
        <PageHeader title="Mission Not Found" />
        <p className="text-muted-foreground">
          This mission could not be found.{' '}
          <Link href={`/missions/stages/${stageId}`} className="underline">
            Back to stage
          </Link>
        </p>
      </div>
    );
  }

  return <MissionDetailContent mission={mission} stageId={stageId} />;
}
