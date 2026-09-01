'use client';

import { useState } from 'react';

import { DataTable } from '@/components/shared/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useArtworks } from '../hooks/use-artwork-queries';
import { artworkColumns } from './artwork-columns';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: 'Fractionalization-relevant' },
  { value: 'verified', label: 'Verified' },
  { value: 'fractionalizing', label: 'Fractionalizing' },
  { value: 'fractionalized', label: 'Fractionalized' },
  { value: 'published', label: 'Published' },
];

export function ArtworkTable() {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const { data, isLoading, isFetching } = useArtworks(status ? { status } : {});

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select
            value={status ?? 'default'}
            onValueChange={(value) => setStatus(value && value !== 'default' ? value : undefined)}
          >
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground">Refreshing...</span>
        )}
      </div>

      <DataTable columns={artworkColumns} data={data?.data ?? []} isLoading={isLoading} />
    </div>
  );
}
