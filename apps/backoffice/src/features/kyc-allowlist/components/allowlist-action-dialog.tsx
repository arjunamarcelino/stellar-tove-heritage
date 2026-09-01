'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { REASON_PATTERN, type AllowlistAction } from '../schemas';

// Reason is optional: allow '' (→ omitted) or a snake_case code. Reuses the canonical REASON_PATTERN
// (single source of truth) while keeping the friendly inline message.
const reasonFormSchema = z.object({
  reason: z
    .string()
    .refine((v) => v === '' || REASON_PATTERN.test(v), 'Lowercase letters, digits or underscore; max 64'),
});
type ReasonForm = z.infer<typeof reasonFormSchema>;

interface AllowlistActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: AllowlistAction;
  wallet: string;
  isPending: boolean;
  onConfirm: (reason: string | undefined) => void;
}

export function AllowlistActionDialog({
  open,
  onOpenChange,
  action,
  wallet,
  isPending,
  onConfirm,
}: AllowlistActionDialogProps) {
  const isRemove = action === 'remove';
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ReasonForm>({
    resolver: zodResolver(reasonFormSchema),
    mode: 'onBlur',
    defaultValues: { reason: '' },
  });

  const submit = handleSubmit(({ reason }) => {
    onConfirm(reason ? reason : undefined);
  });

  return (
    <Dialog
      open={open}
      // Non-dismissable while pending: the dialog is controlled via `open`, and this guarded handler
      // ignores base-ui's close requests (backdrop/esc) until the request settles.
      onOpenChange={(next) => {
        if (isPending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>{isRemove ? 'Remove from allowlist' : 'Add to allowlist'}</DialogTitle>
          <DialogDescription>
            {isRemove
              ? 'This revokes the wallet’s spendability on-chain.'
              : 'This grants the wallet spendability on-chain.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" aria-busy={isPending}>
          <div className="space-y-2">
            <Label>Wallet</Label>
            {/* Echo the exact wallet being acted on (destructive-op safety). */}
            <p className="rounded-md border bg-muted/40 p-2 font-mono text-xs break-all">{wallet}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input id="reason" placeholder="e.g. kyc_passed" {...register('reason')} />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits or underscore; max 64
            </p>
            {errors.reason && (
              <p className="text-sm text-destructive" role="alert">
                {errors.reason.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant={isRemove ? 'destructive' : 'default'} disabled={isPending}>
              {isPending ? 'Submitting…' : isRemove ? 'Remove' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
