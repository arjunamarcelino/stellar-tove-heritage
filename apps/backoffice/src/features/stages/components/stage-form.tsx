'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { stageFormSchema, type StageFormData, type Stage } from '../schemas';

interface StageFormProps {
  initialData?: Stage;
  onSubmit: (data: StageFormData) => void;
  onCancel: () => void;
  isPending?: boolean;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function StageForm({ initialData, onSubmit, onCancel, isPending = false }: StageFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<StageFormData>({
    resolver: zodResolver(stageFormSchema),
    mode: 'onBlur',
    defaultValues: initialData
      ? {
          title: initialData.title,
          description: initialData.description ?? '',
          order: initialData.order,
          isActive: initialData.isActive,
          startsAt: toDatetimeLocal(initialData.startsAt) || null,
        }
      : {
          isActive: false,
          startsAt: null,
        },
  });

  const isActive = watch('isActive');

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...register('title')} />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" {...register('description')} />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="order">Order</Label>
            <Input id="order" type="number" min={1} {...register('order')} />
            {errors.order && <p className="text-sm text-destructive">{errors.order.message}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="isActive"
              checked={isActive}
              onCheckedChange={(checked) => {
                setValue('isActive', checked);
                if (!checked) setValue('startsAt', null);
              }}
            />
            <Label htmlFor="isActive">Active</Label>
          </div>

          {isActive && (
            <div className="space-y-2">
              <Label htmlFor="startsAt">Starts At (optional)</Label>
              <Input id="startsAt" type="datetime-local" {...register('startsAt')} />
              <p className="text-xs text-muted-foreground">
                Leave empty for immediate activation.
              </p>
              {errors.startsAt && (
                <p className="text-sm text-destructive">{errors.startsAt.message}</p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
