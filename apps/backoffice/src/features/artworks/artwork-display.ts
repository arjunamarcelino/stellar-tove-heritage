import type { ArtworkStatus } from './schemas';

export const artworkStatusVariant: Record<
  ArtworkStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  verified: 'secondary',
  published: 'outline',
  fractionalizing: 'outline',
  fractionalized: 'default',
};

export const artworkStatusLabel: Record<ArtworkStatus, string> = {
  verified: 'Verified',
  published: 'Published',
  fractionalizing: 'Fractionalizing',
  fractionalized: 'Fractionalized',
};

/** Display label for an artwork's artist: name, else `@handle`, else an em-dash. */
export function artistLabel(artist: {
  artistName: string | null;
  artistHandle: string | null;
}): string {
  return artist.artistName ?? (artist.artistHandle ? `@${artist.artistHandle}` : '—');
}
