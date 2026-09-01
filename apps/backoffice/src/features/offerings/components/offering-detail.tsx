'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { offeringKeys } from '@/lib/query-keys';
import { ApiError } from '@/types/api';

import { offeringStatusLabel, offeringStatusVariant } from '../offering-display';
import { useOffering } from '../hooks/use-offering-queries';
import { useApproveOffering } from '../hooks/use-offering-mutations';
import { useOfferingApprovalLifecycle } from '../hooks/use-offering-approval-lifecycle';
import { ApprovalQuorumPanel } from './approval-quorum-panel';
import { ApproveOfferingDialog } from './approve-offering-dialog';
import { OfferingPayloadPreview } from './offering-payload-preview';

function BackLink() {
  return (
    <Link href="/offerings" className="text-sm text-muted-foreground hover:underline">
      &larr; Back to offerings
    </Link>
  );
}

export function OfferingDetail({ id }: { id: string }) {
  const { data: offering, isLoading, isError } = useOffering(id);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notASigner, setNotASigner] = useState(false);
  const approve = useApproveOffering(id);
  // Idempotency key OWNED per approve-intent: minted on dialog-open, kept stable across onError retries of
  // the same intent (so a lost-response retry reuses the key → backend dedupe, no double signature),
  // cleared on close/success so a new intent (re-approve after expiry) mints a fresh key.
  const keyRef = useRef<string | null>(null);

  const { panelState } = useOfferingApprovalLifecycle(offering, { notASigner });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Failed to load offering" description="Please try again." />
        <BackLink />
      </div>
    );
  }

  if (!offering || !panelState) {
    return (
      <div className="space-y-6">
        <PageHeader title="Offering not found" />
        <BackLink />
      </div>
    );
  }

  const openApprove = () => {
    keyRef.current = crypto.randomUUID(); // fresh key per approve-intent
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) keyRef.current = null; // cancel/close abandons the intent → next open mints fresh
    setDialogOpen(open);
  };

  const handleConfirm = () => {
    if (!keyRef.current) keyRef.current = crypto.randomUUID(); // safety net
    approve.mutate(keyRef.current, {
      onSuccess: (outcome) => {
        keyRef.current = null;
        setDialogOpen(false);
        if (outcome.kind === 'not-a-signer') {
          setNotASigner(true);
        } else if (outcome.kind === 'accepted' && !outcome.deploying) {
          toast.success('Approval recorded. Awaiting another approver.');
        } else if (outcome.kind === 'neutralized') {
          toast.info('This offering has already progressed.');
        }
      },
      onError: (error) => {
        const code = error instanceof ApiError ? error.code : '';
        // A permission/session failure is NOT retryable — close the dialog rather than invite a doomed
        // retry. (Off-roster is a separate 403 OFFERING_APPROVAL_NOT_A_SIGNER → the sticky not-a-signer
        // panel state, handled below via setNotASigner.)
        if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED') {
          setDialogOpen(false);
          keyRef.current = null;
          toast.error('You do not have permission to approve this offering.');
          return;
        }
        // Otherwise keep the dialog open and the key stable so a retry of THIS intent reuses the key.
        toast.error('Could not record your approval. Please try again.');
      },
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Offering ${offering.id.slice(0, 8)}`}
        action={
          <Badge variant={offeringStatusVariant[offering.status]}>
            {offeringStatusLabel[offering.status]}
          </Badge>
        }
      />

      <OfferingPayloadPreview offering={offering} />

      <ApprovalQuorumPanel
        state={panelState}
        count={offering.approvals.count}
        threshold={offering.approvals.threshold}
        isPending={approve.isPending}
        onApprove={openApprove}
        onCheckAgain={() =>
          void queryClient.invalidateQueries({ queryKey: offeringKeys.detail(id) })
        }
      />

      <BackLink />

      <ApproveOfferingDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        offering={offering}
        isPending={approve.isPending}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
