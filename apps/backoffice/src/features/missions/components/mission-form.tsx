'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { missionFormSchema, type MissionFormData, type Mission } from '../schemas';

interface MissionFormProps {
  stageId: string;
  initialData?: Mission;
  onSubmit: (data: MissionFormData) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function MissionForm({
  stageId,
  initialData,
  onSubmit,
  onCancel,
  isPending = false,
}: MissionFormProps) {
  function getDefaults(): MissionFormData {
    if (!initialData) {
      return {
        title: '',
        order: 1,
        stageId,
        evidenceType: 'text',
        verificationMethod: 'manual',
        verificationConfig: null,
        isActive: true,
      };
    }
    const base = {
      title: initialData.title,
      description: initialData.description ?? '',
      order: initialData.order,
      stageId,
      evidenceType: initialData.evidenceType,
      isActive: initialData.isActive,
    } as const;
    if (initialData.verificationMethod !== 'manual') {
      return {
        ...base,
        verificationMethod: initialData.verificationMethod,
        verificationConfig: initialData.verificationConfig ?? { targetUsername: '' },
      };
    }
    return { ...base, verificationMethod: 'manual', verificationConfig: null };
  }

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<MissionFormData>({
    resolver: zodResolver(missionFormSchema),
    mode: 'onBlur',
    defaultValues: getDefaults(),
  });

  const verificationMethod = watch('verificationMethod');
  const evidenceType = watch('evidenceType');
  const isActive = watch('isActive');
  const needsConfig = verificationMethod === 'auto_x_follow' || verificationMethod === 'auto_instagram_follow';

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <input type="hidden" {...register('stageId')} />

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

          <div className="space-y-2">
            <Label htmlFor="evidenceType">Evidence Type</Label>
            <Select
              value={evidenceType}
              onValueChange={(value) =>
                setValue('evidenceType', value as MissionFormData['evidenceType'])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select evidence type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="url">URL</SelectItem>
                <SelectItem value="file">File</SelectItem>
              </SelectContent>
            </Select>
            {errors.evidenceType && (
              <p className="text-sm text-destructive">{errors.evidenceType.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="verificationMethod">Verification Method</Label>
            <Select
              value={verificationMethod}
              onValueChange={(value) => {
                const method = value as MissionFormData['verificationMethod'];
                setValue('verificationMethod', method);
                if (method === 'manual') {
                  setValue('verificationConfig', null);
                } else {
                  setValue('verificationConfig', { targetUsername: '' });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select verification method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="auto_x_follow">Auto X Follow</SelectItem>
                <SelectItem value="auto_instagram_follow">Auto Instagram Follow</SelectItem>
              </SelectContent>
            </Select>
            {errors.verificationMethod && (
              <p className="text-sm text-destructive">{errors.verificationMethod.message}</p>
            )}
          </div>

          {needsConfig && (
            <div className="space-y-2">
              <Label htmlFor="targetUsername">Target Username</Label>
              <Input
                id="targetUsername"
                {...register('verificationConfig.targetUsername')}
                placeholder="e.g. tove_art"
              />
              {errors.verificationConfig && (
                <p className="text-sm text-destructive">
                  {'targetUsername' in (errors.verificationConfig ?? {})
                    ? (errors.verificationConfig as { targetUsername?: { message?: string } })
                        .targetUsername?.message
                    : errors.verificationConfig.message}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Switch
              id="isActive"
              checked={isActive}
              onCheckedChange={(checked) => setValue('isActive', checked)}
            />
            <Label htmlFor="isActive">Active</Label>
          </div>

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
