'use client';

import type { ReactNode } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

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

import { useFractionalizeArtwork } from '../hooks/use-artwork-mutations';
import { computePublicFloat, fractionalizeFormSchema, type FractionalizeFormData } from '../schemas';

const DEFAULTS: FractionalizeFormData = {
  totalSupply: 100,
  artistRetentionPct: 10,
  treasuryRetentionPct: 5,
  artistLockupDays: 730,
  treasuryLockupDays: 730,
  name: '',
  symbol: '',
};

interface FractionalizeDialogProps {
  artworkId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Scoped subscriptions so a keystroke re-renders only the preview, not the whole form.
function PublicFloatPreview({ control }: { control: Control<FractionalizeFormData> }) {
  const [supply, artistPct, treasuryPct] = useWatch({
    control,
    name: ['totalSupply', 'artistRetentionPct', 'treasuryRetentionPct'],
  });
  const publicFloat = computePublicFloat(supply, artistPct, treasuryPct);
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm" aria-live="polite">
      <p className="text-muted-foreground">Public float</p>
      <p className="font-medium">{publicFloat != null ? publicFloat.toLocaleString() : '—'}</p>
    </div>
  );
}

// Verbatim mint preview — an admin sees exactly what goes on-chain (spoof check).
function MintPreview({ control }: { control: Control<FractionalizeFormData> }) {
  const [name, symbol] = useWatch({ control, name: ['name', 'symbol'] });
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="text-muted-foreground">Will mint as</p>
      <p className="font-mono">
        {name || '—'} ({symbol || '—'})
      </p>
    </div>
  );
}

export function FractionalizeDialog({ artworkId, open, onOpenChange }: FractionalizeDialogProps) {
  const mutation = useFractionalizeArtwork(artworkId);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FractionalizeFormData>({
    resolver: zodResolver(fractionalizeFormSchema),
    mode: 'onBlur',
    defaultValues: DEFAULTS,
  });

  const onValid = (data: FractionalizeFormData) => {
    mutation.mutate(data, {
      onSuccess: (result) => {
        onOpenChange(false);
        toast.success(
          result.kind === 'already'
            ? 'This artwork is already being fractionalized'
            : 'Fractionalization started',
        );
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Non-dismissable while the deploy request is in flight.
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fractionalize artwork</DialogTitle>
          <DialogDescription>
            Deploy the per-artwork FractionToken. This is irreversible.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4">
          <Field id="totalSupply" label="Total supply" error={errors.totalSupply?.message}>
            <Input id="totalSupply" type="number" {...register('totalSupply', { valueAsNumber: true })} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              id="artistRetentionPct"
              label="Artist retention (%)"
              error={errors.artistRetentionPct?.message}
            >
              <Input
                id="artistRetentionPct"
                type="number"
                {...register('artistRetentionPct', { valueAsNumber: true })}
              />
            </Field>
            <Field
              id="treasuryRetentionPct"
              label="Treasury retention (%)"
              error={errors.treasuryRetentionPct?.message}
            >
              <Input
                id="treasuryRetentionPct"
                type="number"
                {...register('treasuryRetentionPct', { valueAsNumber: true })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field
              id="artistLockupDays"
              label="Artist lockup (days)"
              error={errors.artistLockupDays?.message}
            >
              <Input
                id="artistLockupDays"
                type="number"
                {...register('artistLockupDays', { valueAsNumber: true })}
              />
            </Field>
            <Field
              id="treasuryLockupDays"
              label="Treasury lockup (days)"
              error={errors.treasuryLockupDays?.message}
            >
              <Input
                id="treasuryLockupDays"
                type="number"
                {...register('treasuryLockupDays', { valueAsNumber: true })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field id="name" label="Token name" error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </Field>
            <Field id="symbol" label="Token symbol" error={errors.symbol?.message}>
              <Input id="symbol" {...register('symbol')} />
            </Field>
          </div>

          <PublicFloatPreview control={control} />
          <MintPreview control={control} />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Deploying…' : 'Fractionalize'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
