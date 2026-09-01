'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { dateTimeFormatter } from '@/lib/date-format';

import { formatPriceBand, formatPublicFloat } from '../offering-display';
import type { OfferingDetail } from '../schemas';

interface ApproveOfferingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offering: OfferingDetail;
  isPending: boolean;
  onConfirm: () => void;
}

/**
 * Confirm dialog for an approval. Echoes the exact economic payload at the moment of signing
 * (verify-before-sign — the primary multisig safety control). Non-dismissable while the request is in
 * flight. No form fields (empty request body), so a plain confirm button drives the action.
 */
export function ApproveOfferingDialog({
  open,
  onOpenChange,
  offering,
  isPending,
  onConfirm,
}: ApproveOfferingDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return; // ignore backdrop/esc while the request settles
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>Approve offering</DialogTitle>
          <DialogDescription>
            Verify the terms below — including the payout address the escrow will pay. Your approval is
            one of {offering.approvals.threshold} required signatures and attests this payload is correct;
            quorum triggers the on-chain escrow deploy.
          </DialogDescription>
        </DialogHeader>

        <dl className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Price band</dt>
            <dd className="tabular-nums">
              {formatPriceBand(offering.lowPriceStroops, offering.highPriceStroops)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Public float</dt>
            <dd className="tabular-nums">{formatPublicFloat(offering.publicFloat)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Window opens</dt>
            <dd>{dateTimeFormatter.format(new Date(offering.windowOpenAt))}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Attested payout</dt>
            <dd className="font-mono text-xs break-all" title={offering.attestedArtistAddress ?? undefined}>
              {offering.attestedArtistAddress ?? 'Not attested'}
            </dd>
          </div>
        </dl>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Submitting…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
