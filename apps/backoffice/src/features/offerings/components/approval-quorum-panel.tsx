'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { assertNever } from '@/lib/assert-never';
import { explorerContractUrl } from '@/lib/stellar';

import { offeringStatusLabel } from '../offering-display';
import type { ApprovalPanelState } from '../hooks/use-offering-approval-lifecycle';

export interface ApprovalQuorumPanelProps {
  state: ApprovalPanelState;
  count: number;
  threshold: number;
  isPending: boolean;
  /** Opens the confirm dialog. */
  onApprove: () => void;
  /** Manual poll resume for the deploying/timeout state. */
  onCheckAgain?: () => void;
}

/**
 * SHARED co-sign panel (reused by FR-09.05). Props-only: it never fetches and never renders signer
 * identities (only the `count / threshold` text + the caller's own derived state). The mutation lives in
 * the container, passed in as `onApprove` + `isPending`. Exhaustive over {@link ApprovalPanelState}.
 */
export function ApprovalQuorumPanel({
  state,
  count,
  threshold,
  isPending,
  onApprove,
  onCheckAgain,
}: ApprovalQuorumPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Approval</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm tabular-nums">
          <span className="font-medium">
            {count} of {threshold}
          </span>{' '}
          approvals
        </p>
        {renderBody(state, { isPending, onApprove, onCheckAgain })}
      </CardContent>
    </Card>
  );
}

function renderBody(
  state: ApprovalPanelState,
  { isPending, onApprove, onCheckAgain }: Pick<
    ApprovalQuorumPanelProps,
    'isPending' | 'onApprove' | 'onCheckAgain'
  >,
) {
  switch (state.kind) {
    case 'can-approve':
      return (
        <Button onClick={onApprove} disabled={isPending}>
          {isPending ? 'Submitting…' : 'Approve offering'}
        </Button>
      );
    case 'already-approved':
      return (
        <p role="status" className="text-sm text-muted-foreground">
          You have approved. Awaiting another approver.
        </p>
      );
    case 'not-a-signer':
      return (
        <p role="status" className="text-sm text-muted-foreground">
          You are not an approver for this offering.
        </p>
      );
    case 'deploying':
      return (
        <div role="status" aria-busy="true" className="space-y-2">
          <p className="text-sm font-medium">Deploying escrow…</p>
          <p className="text-xs text-muted-foreground">
            This usually takes under a minute. Taking longer than expected?
          </p>
          {onCheckAgain && (
            <Button variant="outline" size="sm" onClick={onCheckAgain}>
              Check again
            </Button>
          )}
        </div>
      );
    case 'deployed': {
      const url = explorerContractUrl(state.contractAddress);
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium">Escrow deployed</p>
          <p className="font-mono text-sm break-all" title={state.contractAddress}>
            {state.contractAddress}
          </p>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              View on stellar.expert ↗
            </a>
          )}
        </div>
      );
    }
    case 'deploy-failed':
      return (
        <div className="space-y-2" role="status">
          <p className="text-sm font-medium text-destructive">Escrow deploy failed</p>
          <p className="text-xs text-muted-foreground">Any approver can retry.</p>
          <Button onClick={onApprove} disabled={isPending}>
            {isPending ? 'Submitting…' : 'Retry approval'}
          </Button>
        </div>
      );
    case 'read-only':
      return (
        <p className="text-sm text-muted-foreground">
          This offering is {offeringStatusLabel[state.status].toLowerCase()} — no approval action
          available.
        </p>
      );
    default:
      return assertNever(state);
  }
}
