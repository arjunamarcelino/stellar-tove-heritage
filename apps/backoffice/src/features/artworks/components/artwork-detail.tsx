'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { explorerContractUrl } from '@/lib/stellar';

import { useArtwork, useFractionalizationLifecycle } from '../hooks/use-artwork-queries';
import { artworkStatusVariant, artworkStatusLabel, artistLabel } from '../artwork-display';
import { FractionalizeDialog } from './fractionalize-dialog';
import type { ArtworkDetail as ArtworkDetailModel } from '../schemas';

function BackLink() {
  return (
    <Link href="/artworks" className="text-sm text-muted-foreground hover:underline">
      &larr; Back to artworks
    </Link>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function FractionContractPanel({ artwork }: { artwork: ArtworkDetailModel }) {
  const fc = artwork.fractionContract;
  if (!fc) return null;
  const url = fc.tokenAddress ? explorerContractUrl(fc.tokenAddress) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Fraction token</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Contract address</p>
            <p className="font-mono text-sm break-all">{fc.tokenAddress ?? 'Deploying…'}</p>
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
          <DetailField label="Total supply" value={fc.totalSupply} />
          <DetailField label="Artist retention" value={`${fc.artistRetentionPct}%`} />
          <DetailField label="Treasury retention" value={`${fc.treasuryRetentionPct}%`} />
        </div>
      </CardContent>
    </Card>
  );
}

export function ArtworkDetail({ artworkId }: { artworkId: string }) {
  const { data: artwork, isLoading, isError } = useArtwork(artworkId);
  const [dialogOpen, setDialogOpen] = useState(false);

  // The lifecycle hook owns the poll + terminal toast/invalidation and derives the display flags, keeping
  // this component a pure read view. `failed` is terminal for the view (shows a failure block, not a stuck
  // "Deploying…"); the poll is gated on the artwork latch OR an active `deploying` contract.
  const { isDeploying, deployFailed } = useFractionalizationLifecycle(
    artworkId,
    artwork?.status,
    artwork?.fractionContract?.status,
  );

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
        <PageHeader
          title="Failed to load artwork"
          description="Something went wrong fetching this artwork. Please try again."
        />
        <BackLink />
      </div>
    );
  }

  if (!artwork) {
    return (
      <div className="space-y-6">
        <PageHeader title="Artwork not found" />
        <BackLink />
      </div>
    );
  }

  const canFractionalize = artwork.status === 'verified' && artwork.fractionContract == null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={artwork.title}
        action={
          <div className="flex items-center gap-3">
            <Badge variant={artworkStatusVariant[artwork.status]}>
              {artworkStatusLabel[artwork.status]}
            </Badge>
            {canFractionalize && (
              <Button onClick={() => setDialogOpen(true)}>Fractionalize</Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <DetailField label="Artist" value={artistLabel(artwork)} />
            <DetailField label="Year" value={artwork.year != null ? String(artwork.year) : '—'} />
            <DetailField label="Medium" value={artwork.medium ?? '—'} />
            <DetailField label="Dimensions" value={artwork.dimensions ?? '—'} />
          </div>
        </CardContent>
      </Card>

      {isDeploying && (
        <div className="rounded-md border bg-muted/40 p-4 text-sm" role="status">
          <p className="font-medium">Deploying fraction token…</p>
          <p className="text-muted-foreground">This usually takes under a minute.</p>
        </div>
      )}

      {deployFailed && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
          role="alert"
        >
          <p className="font-medium text-destructive">Fractionalization failed</p>
          <p className="text-muted-foreground">
            The fraction token was not deployed. You can try again.
          </p>
        </div>
      )}

      <FractionContractPanel artwork={artwork} />

      <BackLink />

      <FractionalizeDialog artworkId={artworkId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
